#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod lifecycle;

use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{Manager, WebviewWindow};

struct Smoke {
    report: Option<PathBuf>,
}

#[tauri::command]
fn smoke_finished(app: tauri::AppHandle, smoke: tauri::State<Smoke>, passed: bool) {
    if let Some(path) = &smoke.report {
        let _ = std::fs::write(
            path,
            serde_json::json!({"passed": passed, "webview": true}).to_string(),
        );
        app.exit(if passed { 0 } else { 1 });
    }
}

fn error_page(window: &WebviewWindow, message: &str) {
    let message = serde_json::to_string(message).unwrap();
    // Only native sanitized messages enter the page; no document or model text.
    let _ = window.eval(&format!("document.body.replaceChildren(); const h=document.createElement('h1'); h.textContent='DocQA could not continue'; const p=document.createElement('p'); p.setAttribute('role','alert'); p.textContent={message}; document.body.append(h,p);"));
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let value = |flag: &str| {
        args.iter()
            .position(|arg| arg == flag)
            .and_then(|i| args.get(i + 1))
            .map(PathBuf::from)
    };
    let smoke_report = if args.iter().any(|s| s == "--smoke-test") {
        value("--smoke-report")
    } else {
        None
    };
    let data_override = if smoke_report.is_some() {
        value("--data-dir")
    } else {
        None
    };
    let smoke_enabled = smoke_report.is_some();
    let cancel = Arc::new(AtomicBool::new(false));
    let worker = Arc::new(Mutex::new(None));
    let worker_setup = worker.clone();
    let stop_setup = cancel.clone();
    let app = tauri::Builder::default()
        .manage(Smoke {
            report: smoke_report,
        })
        .invoke_handler(tauri::generate_handler![smoke_finished])
        .on_page_load(move |window, payload| {
            if smoke_enabled
                && payload.url().path() == "/"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
            {
                let _ = window.eval(include_str!("smoke.js"));
            }
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            let payload = app.path().resource_dir()?.join("payload");
            let data = data_override.unwrap_or(app.path().app_local_data_dir()?);
            *worker_setup.lock().unwrap() = Some(thread::spawn(move || {
                let result = lifecycle::start(&payload, &data, &stop_setup);
                let Some(window) = handle.get_webview_window("main") else {
                    return;
                };
                match result {
                    Ok(mut services) => {
                        if stop_setup.load(Ordering::SeqCst) {
                            return;
                        }
                        let mut url = window.url().unwrap();
                        url.set_path("/");
                        if window.navigate(url).is_err() {
                            handle.exit(1);
                            return;
                        }
                        let started = std::time::Instant::now();
                        while !stop_setup.load(Ordering::SeqCst) {
                            if let Err(message) = services.check() {
                                error_page(&window, &message);
                                if smoke_enabled {
                                    handle.exit(1);
                                }
                                break;
                            }
                            if smoke_enabled && started.elapsed() > Duration::from_secs(90) {
                                handle.exit(1);
                                break;
                            }
                            thread::sleep(Duration::from_millis(200));
                        }
                    }
                    Err(message) => {
                        error_page(&window, &message);
                        if smoke_enabled {
                            handle.exit(1);
                        }
                    }
                }
            }));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Cannot initialize the desktop application");
    app.run(move |_app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            cancel.store(true, Ordering::SeqCst);
            if let Some(worker) = worker.lock().unwrap().take() {
                let _ = worker.join();
            }
        }
    });
}
