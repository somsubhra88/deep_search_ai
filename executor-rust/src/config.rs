//! Cross-OS storage paths and configuration.

use std::path::PathBuf;

/// Get the application data directory for the current OS.
/// - Windows: %APPDATA%/DeepSearchAI/
/// - macOS: ~/Library/Application Support/DeepSearchAI/
/// - Linux: ~/.local/share/deepsearchai/
pub fn app_data_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
        PathBuf::from(appdata).join("DeepSearchAI")
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        PathBuf::from(home).join("Library/Application Support/DeepSearchAI")
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        PathBuf::from(home).join(".local/share/deepsearchai")
    }
}

/// Ensure the app data directory exists.
pub fn ensure_app_data_dir() -> std::io::Result<PathBuf> {
    let dir = app_data_dir();
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Get the database path.
pub fn db_path() -> PathBuf {
    let mut p = app_data_dir();
    p.push("rules.db");
    p
}

/// Get the logs directory.
pub fn logs_dir() -> PathBuf {
    let mut p = app_data_dir();
    p.push("logs");
    p
}

/// Get the undo/backup directory for rollback.
pub fn undo_dir() -> PathBuf {
    let mut p = app_data_dir();
    p.push("undo");
    p
}
