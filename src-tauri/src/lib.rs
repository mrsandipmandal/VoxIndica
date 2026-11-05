use tauri::{RunEvent, WebviewUrl, WebviewWindowBuilder};

#[cfg(not(debug_assertions))]
use std::fs::OpenOptions;
#[cfg(not(debug_assertions))]
use std::io::{Read, Write};
#[cfg(not(debug_assertions))]
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
#[cfg(not(debug_assertions))]
use std::sync::Mutex;
#[cfg(not(debug_assertions))]
use std::time::{Duration, Instant};
#[cfg(not(debug_assertions))]
use tauri::Manager;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;

#[cfg(not(debug_assertions))]
const SIDECAR_NAME: &str = "voxindica-server";
#[cfg(not(debug_assertions))]
const STARTUP_TIMEOUT: Duration = Duration::from_secs(20);

/// The Node SEA sidecar, kept alive for the lifetime of the window.
#[cfg(not(debug_assertions))]
struct SidecarState(Mutex<Option<CommandChild>>);

#[cfg(not(debug_assertions))]
fn free_port() -> Result<u16, Box<dyn std::error::Error>> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

#[cfg(not(debug_assertions))]
fn server_is_ready(port: u16) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(
        &SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        Duration::from_millis(300),
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let request =
        format!("GET /healthz HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = [0_u8; 64];
    match stream.read(&mut response) {
        Ok(read) if read > 0 => {
            String::from_utf8_lossy(&response[..read]).starts_with("HTTP/1.1 200")
        }
        _ => false,
    }
}

#[cfg(not(debug_assertions))]
fn wait_for_server(port: u16) -> bool {
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    while Instant::now() < deadline {
        if server_is_ready(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

/// GUI apps on macOS do not inherit the shell PATH, so Homebrew locations are
/// appended before starting the sidecar (ffmpeg is a documented local dependency).
#[cfg(not(debug_assertions))]
fn augmented_path() -> String {
    let mut value = std::env::var("PATH").unwrap_or_default();
    #[cfg(target_os = "macos")]
    {
        for candidate in ["/opt/homebrew/bin", "/usr/local/bin"] {
            if !value.split(':').any(|entry| entry == candidate) {
                value.push(':');
                value.push_str(candidate);
            }
        }
    }
    value
}

#[cfg(not(debug_assertions))]
fn append_desktop_log(app: &tauri::AppHandle, message: &str) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("desktop.log"))
    else {
        return;
    };
    let _ = writeln!(file, "{message}");
    let _ = file.flush();
}

#[cfg(not(debug_assertions))]
fn start_sidecar(app: &mut tauri::App) -> Result<u16, Box<dyn std::error::Error>> {
    let port = free_port()?;
    let resource_dir = app.path().resource_dir()?;
    let data_dir = app.path().app_data_dir()?;
    let config_dir = app.path().app_config_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    std::fs::create_dir_all(&config_dir)?;
    append_desktop_log(
        app.handle(),
        &format!("\n--- VoxIndica desktop sidecar starting on 127.0.0.1:{port} ---"),
    );

    let command = app
        .shell()
        .sidecar(SIDECAR_NAME)?
        .env("PORT", port.to_string())
        .env("HOST", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("PATH", augmented_path())
        .env("VOXINDICA_WEB_DIR", resource_dir.join("dist"))
        .env("VOXINDICA_DOCS_DIR", resource_dir.join("docs"))
        .env("VOXINDICA_NOTEBOOKS_DIR", resource_dir.join("notebooks"))
        .env("VOXINDICA_CREATOR_DATA_DIR", data_dir.join("projects"))
        .env("VOXINDICA_BATCH_DATA_DIR", data_dir.join("batches"))
        .env("VOXINDICA_ENV_FILE", config_dir.join(".env"))
        .env("VOXINDICA_RESOURCE_DIR", &resource_dir)
        .current_dir(&data_dir)
        .set_process_group(true)
        .kill_on_drop(true);

    let (mut rx, child) = command.spawn()?;

    let log_app = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            let message = match event {
                CommandEvent::Stdout(line) => {
                    let message =
                        format!("[sidecar] {}", String::from_utf8_lossy(&line).trim_end());
                    println!("{message}");
                    message
                }
                CommandEvent::Stderr(line) => {
                    let message =
                        format!("[sidecar] {}", String::from_utf8_lossy(&line).trim_end());
                    eprintln!("{message}");
                    message
                }
                CommandEvent::Error(error) => {
                    let message = format!("[sidecar] {error}");
                    eprintln!("{message}");
                    message
                }
                CommandEvent::Terminated(payload) => {
                    let message = format!("[sidecar] terminated (code {:?})", payload.code);
                    eprintln!("{message}");
                    message
                }
                _ => continue,
            };
            append_desktop_log(&log_app, &message);
        }
    });

    // Dropping `child` on failure kills the sidecar process group.
    if !wait_for_server(port) {
        let message = format!("[desktop] the studio server did not answer on 127.0.0.1:{port}");
        eprintln!("{message}");
        append_desktop_log(app.handle(), &message);
        return Err(message.into());
    }

    app.manage(SidecarState(Mutex::new(Some(child))));
    Ok(port)
}

fn create_window(app: &tauri::AppHandle, url: WebviewUrl) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, "main", url)
        .title("VoxIndica Studio")
        .inner_size(1280.0, 820.0)
        .min_inner_size(1024.0, 640.0)
        .center()
        .build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let url = std::env::var("VOXINDICA_DEV_URL")
                    .unwrap_or_else(|_| "http://localhost:3000".to_string());
                create_window(app.handle(), WebviewUrl::External(url.parse()?))?;
            }

            #[cfg(not(debug_assertions))]
            {
                match start_sidecar(app) {
                    Ok(port) => {
                        let url = format!("http://127.0.0.1:{port}");
                        create_window(app.handle(), WebviewUrl::External(url.parse()?))?;
                    }
                    Err(error) => {
                        let message =
                            format!("[desktop] could not start the studio server: {error}");
                        eprintln!("{message}");
                        append_desktop_log(app.handle(), &message);
                        create_window(app.handle(), WebviewUrl::App("desktop-error.html".into()))?;
                    }
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build VoxIndica Studio")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                #[cfg(not(debug_assertions))]
                if let Some(state) = app_handle.try_state::<SidecarState>() {
                    if let Some(child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
                #[cfg(debug_assertions)]
                let _ = app_handle;
            }
        });
}
