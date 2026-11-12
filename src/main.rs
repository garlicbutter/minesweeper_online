use minefield::server::{AppState, router};
use std::{path::PathBuf, time::Duration};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = PathBuf::from(std::env::var("DATA_DIR").unwrap_or_else(|_| ".data".into()));
    let state = AppState::load(data_dir).await?;
    let writer = state.clone();
    let persistence = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(150));
        loop {
            interval.tick().await;
            writer.advance_bots();
            if let Err(e) = writer.flush().await {
                eprintln!("Could not save rooms: {e}");
            }
        }
    });
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "3000".into())
        .parse()?;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::UNSPECIFIED, port)).await?;
    println!("Minefield ready at http://localhost:{port}");
    let result = axum::serve(listener, router(state.clone()))
        .with_graceful_shutdown(shutdown())
        .await;
    persistence.abort();
    if let Err(e) = state.flush().await {
        eprintln!("Could not save rooms during shutdown: {e}");
    }
    result?;
    Ok(())
}
async fn shutdown() {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler");
        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = term.recv() => {} }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
