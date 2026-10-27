use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

pub struct Services {
    children: Vec<Child>,
    _instance: TcpListener,
    #[cfg(windows)]
    job: windows_sys::Win32::Foundation::HANDLE,
}

impl Services {
    pub fn new() -> Result<Self, String> {
        let instance = TcpListener::bind("127.0.0.1:8764").map_err(|_| {
            "Another DocQA instance is running, or port 8764 is occupied. Close it and restart."
                .to_string()
        })?;
        #[cfg(windows)]
        let job = unsafe {
            use windows_sys::Win32::System::JobObjects::*;
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err("Cannot create the service process group.".into());
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            ) == 0
            {
                windows_sys::Win32::Foundation::CloseHandle(job);
                return Err("Cannot configure service cleanup.".into());
            }
            job
        };
        Ok(Self {
            children: Vec::new(),
            _instance: instance,
            #[cfg(windows)]
            job,
        })
    }

    pub fn spawn(&mut self, exe: &Path, args: &[&str], data: &Path) -> Result<(), String> {
        let mut cmd = Command::new(exe);
        cmd.args(args)
            .current_dir(data)
            .env("SECURE_QA_DATA_DIR", data)
            .env("HF_HUB_OFFLINE", "1")
            .env("TRANSFORMERS_OFFLINE", "1")
            .env("ANONYMIZED_TELEMETRY", "False")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        let mut child = cmd.spawn().map_err(|_| {
            "Cannot start a bundled service. Reinstall the complete application.".to_string()
        })?;
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            if unsafe {
                windows_sys::Win32::System::JobObjects::AssignProcessToJobObject(
                    self.job,
                    child.as_raw_handle() as _,
                )
            } == 0
            {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Cannot supervise the bundled service safely.".into());
            }
        }
        self.children.push(child);
        Ok(())
    }

    pub fn check(&mut self) -> Result<(), String> {
        for child in &mut self.children {
            if child
                .try_wait()
                .map_err(|_| "Cannot inspect the local service.")?
                .is_some()
            {
                return Err("A local service stopped. Close the app and restart; if it repeats, reinstall the complete bundle.".into());
            }
        }
        Ok(())
    }

    pub fn wait(&mut self, port: u16, host: bool, cancel: &AtomicBool) -> Result<(), String> {
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(180) {
            if cancel.load(Ordering::SeqCst) {
                return Err("Startup cancelled.".into());
            }
            self.check()?;
            if let Ok(value) = health(port) {
                if !host || value["api_version"] == "secure-qa-dev/1" {
                    return Ok(());
                }
            }
            thread::sleep(Duration::from_millis(200));
        }
        Err("The local service did not start within three minutes. Close the app and check the installed assets.".into())
    }
}

impl Drop for Services {
    fn drop(&mut self) {
        for child in self.children.iter_mut().rev() {
            #[cfg(unix)]
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGTERM);
            }
            let _ = child.kill();
            let _ = child.wait();
        }
        #[cfg(windows)]
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.job);
        }
    }
}

pub fn free_port(port: u16) -> Result<(), String> {
    TcpListener::bind(("127.0.0.1", port))
        .map(|_| ())
        .map_err(|_| {
            format!("Local port {port} is occupied. Close the other service and restart DocQA.")
        })
}

pub fn health(port: u16) -> Result<serde_json::Value, String> {
    let mut stream = TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}").parse().unwrap(),
        Duration::from_millis(500),
    )
    .map_err(|_| "Service unavailable".to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|e| e.to_string())?;
    write!(
        stream,
        "GET /health HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    )
    .map_err(|e| e.to_string())?;
    let mut response = String::new();
    stream
        .take(65536)
        .read_to_string(&mut response)
        .map_err(|e| e.to_string())?;
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or("Invalid health response")?;
    if !headers.lines().next().unwrap_or("").contains(" 200 ") {
        return Err("Service not ready".into());
    }
    serde_json::from_str(body).map_err(|_| "Invalid health JSON".into())
}

pub fn start(payload: &Path, data: &Path, cancel: &AtomicBool) -> Result<Services, String> {
    fs::create_dir_all(data).map_err(|_| "Cannot create the application data folder.")?;
    let mut services = Services::new()?;
    free_port(8765)?;
    let exe = payload.join("host").join(if cfg!(windows) {
        "docqa-service.exe"
    } else {
        "docqa-service"
    });
    let profile: serde_json::Value = serde_json::from_slice(
        &fs::read(payload.join("profile.json"))
            .map_err(|_| "The installed payload is incomplete. Reinstall the app.")?,
    )
    .map_err(|_| "The installed profile is invalid.")?;
    match profile["mode"].as_str() {
        Some("demo") => services.spawn(&exe, &["host", "--runtime", "fake"], data)?,
        Some("real") => {
            free_port(8080)?;
            let runtime = payload.join("runtime");
            let config = runtime.join("runtime.toml");
            let bin = runtime.join("bin").join(if cfg!(windows) {
                "llama-server.exe"
            } else {
                "llama-server"
            });
            let models = runtime.join("models");
            let embeddings = runtime.join("embedding");
            let output = data.join("runtime");
            fs::create_dir_all(&output).map_err(|_| "Cannot create the runtime data folder.")?;
            services.spawn(
                &exe,
                &[
                    "runtime",
                    "up",
                    "--config",
                    config.to_str().ok_or("Invalid path")?,
                    "--server-bin",
                    bin.to_str().ok_or("Invalid path")?,
                    "--models-dir",
                    models.to_str().ok_or("Invalid path")?,
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "8080",
                ],
                &output,
            )?;
            services.wait(8080, false, cancel)?;
            services.spawn(
                &exe,
                &[
                    "host",
                    "--runtime",
                    "http://127.0.0.1:8080",
                    "--embedding-model",
                    embeddings.to_str().ok_or("Invalid path")?,
                ],
                data,
            )?;
        }
        _ => return Err("The installed profile is unsupported.".into()),
    }
    services.wait(8765, true, cancel)?;
    Ok(services)
}
