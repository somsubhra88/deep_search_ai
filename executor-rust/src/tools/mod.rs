//! Tool implementations with workspace sandbox checks.

mod fs;
mod net;
mod archive;
mod shell;
mod notes;
mod clipboard;

use crate::models::ToolRequest;
use crate::policy::{path_under_workspace, resolve_in_workspace};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ToolError {
    #[error("policy: {0}")]
    Policy(#[from] crate::policy::PolicyError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("download: {0}")]
    Download(String),
    #[error("archive: {0}")]
    Archive(String),
}

#[derive(Debug, Serialize)]
pub struct ToolResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub undo: Option<crate::rollback::UndoAction>,
}

pub fn ok_result(data: serde_json::Value) -> ToolResult {
    ToolResult {
        ok: true,
        data: Some(data),
        error: None,
        undo: None,
    }
}

pub fn ok_result_with_undo(data: serde_json::Value, undo: crate::rollback::UndoAction) -> ToolResult {
    ToolResult {
        ok: true,
        data: Some(data),
        error: None,
        undo: Some(undo),
    }
}

fn err_result(msg: &str) -> ToolResult {
    ToolResult {
        ok: false,
        data: None,
        error: Some(msg.to_string()),
        undo: None,
    }
}

pub fn execute(tool: &ToolRequest, dry_run: bool) -> ToolResult {
    use crate::models::ToolRequest::*;
    if dry_run {
        return execute_dry_run(tool);
    }
    match tool {
        FsList { path } => fs::list(path),
        FsRead { path } => fs::read(path),
        FsStat { path } => fs::stat(path),
        FsWrite { path, content } => fs::write(path, content),
        FsAppend { path, content } => fs::append(path, content),
        FsCopy { src, dst } => fs::copy(src, dst),
        FsMove { src, dst } => fs::move_(src, dst),
        FsRename { src, dst } => fs::rename(src, dst),
        FsDelete { path } => fs::delete(path),
        NetDownload { url, dst_path } => net::download(url, dst_path),
        ArchiveExtract { archive_path, dst_dir } => archive::extract(archive_path, dst_dir),
        ShellRun { cmd, cwd } => shell::run(cmd, cwd.as_deref()),
        NotesCreate { title, content, folder } => notes::create(title, content, folder.as_deref()),
        NotesUpdate { title, content, folder } => notes::update(title, content, folder.as_deref()),
        NotesSearch { query, folder } => notes::search(query, folder.as_deref()),
        ClipboardRead => clipboard::read(),
        ClipboardWrite { content } => clipboard::write(content),
    }
}

pub fn execute_dry_run(tool: &ToolRequest) -> ToolResult {
    use crate::models::ToolRequest::*;
    let plan = match tool {
        FsList { path } => serde_json::json!({ "would": "list directory", "path": path }),
        FsRead { path } => serde_json::json!({ "would": "read file", "path": path }),
        FsStat { path } => serde_json::json!({ "would": "stat path", "path": path }),
        FsWrite { path, content } => serde_json::json!({ "would": "write file", "path": path, "bytes": content.len() }),
        FsAppend { path, content } => serde_json::json!({ "would": "append to file", "path": path, "bytes": content.len() }),
        FsCopy { src, dst } => serde_json::json!({ "would": "copy", "src": src, "dst": dst }),
        FsMove { src, dst } => serde_json::json!({ "would": "move", "src": src, "dst": dst }),
        FsRename { src, dst } => serde_json::json!({ "would": "rename", "src": src, "dst": dst }),
        FsDelete { path } => serde_json::json!({ "would": "trash", "path": path }),
        NetDownload { url, dst_path } => serde_json::json!({ "would": "download", "url": url, "dst": dst_path }),
        ArchiveExtract { archive_path, dst_dir } => serde_json::json!({ "would": "extract", "archive": archive_path, "dst": dst_dir }),
        ShellRun { cmd, cwd } => serde_json::json!({ "would": "run shell", "cmd": cmd, "cwd": cwd }),
        NotesCreate { title, content, folder } => serde_json::json!({ "would": "create note", "title": title, "folder": folder }),
        NotesUpdate { title, content, folder } => serde_json::json!({ "would": "update note", "title": title, "folder": folder }),
        NotesSearch { query, folder } => serde_json::json!({ "would": "search notes", "query": query, "folder": folder }),
        ClipboardRead => serde_json::json!({ "would": "read clipboard" }),
        ClipboardWrite { content } => serde_json::json!({ "would": "write clipboard", "bytes": content.len() }),
    };
    ok_result(serde_json::json!({ "dry_run": true, "plan": plan }))
}
