//! Undo/rollback: store backups and restore via shell in background.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UndoEntry {
    pub id: String,
    pub run_id: String,
    pub action: UndoAction,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum UndoAction {
    FsWrite { path: String, backup_path: String },
    FsDelete { path: String, backup_path: String },
    FsMove { src: String, dst: String, backup_path: String },
}

pub struct RollbackStore {
    entries: Mutex<VecDeque<UndoEntry>>,
    max_entries: usize,
}

impl RollbackStore {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(VecDeque::new()),
            max_entries: 50,
        }
    }

    pub fn push(&self, run_id: &str, action: UndoAction) -> String {
        let id = Uuid::new_v4().to_string();
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let entry = UndoEntry {
            id: id.clone(),
            run_id: run_id.to_string(),
            action: action.clone(),
            created_at,
        };
        let mut guard = self.entries.lock().unwrap();
        guard.push_back(entry);
        while guard.len() > self.max_entries {
            if let Some(old) = guard.pop_front() {
                if let Some(backup) = old.action.backup_path() {
                    let _ = std::fs::remove_file(&backup);
                }
            }
        }
        id
    }

    pub fn pop(&self) -> Option<UndoEntry> {
        self.entries.lock().unwrap().pop_back()
    }

    pub fn undo_by_id(&self, id: &str) -> Option<UndoEntry> {
        let mut guard = self.entries.lock().unwrap();
        let pos = guard.iter().position(|e| e.id == id)?;
        let entry = guard.remove(pos)?;
        Some(entry)
    }

    pub fn list(&self) -> Vec<UndoEntry> {
        self.entries.lock().unwrap().iter().cloned().rev().collect()
    }
}

impl UndoAction {
    pub fn backup_path(&self) -> Option<PathBuf> {
        match self {
            UndoAction::FsWrite { backup_path, .. }
            | UndoAction::FsDelete { backup_path, .. }
            | UndoAction::FsMove { backup_path, .. } => Some(PathBuf::from(backup_path)),
        }
    }

    /// Returns the shell command to restore (run in background).
    pub fn restore_command(&self) -> String {
        match self {
            UndoAction::FsWrite { path, backup_path } => {
                format!("cp -f \"{}\" \"{}\"", backup_path, path)
            }
            UndoAction::FsDelete { path, backup_path } => {
                let parent = std::path::Path::new(path).parent().map(|p| p.to_string_lossy()).unwrap_or_default();
                format!("mkdir -p \"{}\" && cp -rf \"{}\" \"{}\"", parent, backup_path, path)
            }
            UndoAction::FsMove { src, dst, backup_path } => {
                format!("rm -rf \"{}\" 2>/dev/null; cp -rf \"{}\" \"{}\"", dst, backup_path, src)
            }
        }
    }
}
