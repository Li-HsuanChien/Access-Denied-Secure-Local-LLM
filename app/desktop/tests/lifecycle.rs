#[path = "../src-tauri/src/lifecycle.rs"]
#[allow(dead_code)]
mod lifecycle;

use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::atomic::AtomicBool,
    thread,
    time::{Duration, Instant},
};

#[test]
fn lifecycle_rejects_other_instances_cancels_startup_and_releases_ownership() {
    let mut services = lifecycle::Services::new().unwrap();
    assert!(lifecycle::Services::new().is_err());
    let start = Instant::now();
    assert!(services.wait(1, true, &AtomicBool::new(true)).is_err());
    assert!(start.elapsed().as_secs() < 1);
    drop(services);
    assert!(lifecycle::free_port(8764).is_ok());
}

#[test]
fn readiness_reads_real_http_and_refuses_failed_health() {
    for status in [200, 503] {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = server.local_addr().unwrap().port();
        assert!(lifecycle::free_port(port).is_err());
        let worker = thread::spawn(move || {
            let (mut stream, _) = server.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            // A TCP read can return only part of the request. Closing with
            // unread request bytes can reset the connection on Windows.
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0u8; 1];
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
                assert!(request.len() <= 2048, "Health request headers too large");
            }
            assert!(request.starts_with(b"GET /health HTTP/1.0\r\n"));
            stream
                .write_all(format!("HTTP/1.0 {status} Test\r\n\r\n{{\"ready\":true}}").as_bytes())
                .unwrap();
        });
        let result = lifecycle::health(port);
        worker.join().unwrap();
        assert_eq!(result.is_ok(), status == 200, "HTTP {status}: {result:?}");
    }
}
