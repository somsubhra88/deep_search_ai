use super::{err_result, ok_result, ok_result_with_undo, ToolError, ToolResult};
use crate::config::{ensure_app_data_dir, undo_dir};
use crate::policy::{path_under_workspace, resolve_in_workspace};
use crate::rollback::UndoAction;
use std::fs;
use std::path::Path;
use uuid::Uuid;

pub fn list(path: &str) -> ToolResult {
    match list_impl(path) {
        Ok(entries) => ok_result(serde_json::json!({ "entries": entries })),
        Err(e) => err_result(&e.to_string()),
    }
}

fn list_impl(path: &str) -> Result<Vec<serde_json::Value>, ToolError> {
    let base = resolve_in_workspace(path)?;
    let mut entries = Vec::new();
    for e in fs::read_dir(&base)? {
        let e = e?;
        let name = e.file_name().to_string_lossy().to_string();
        let meta = e.metadata()?;
        let is_dir = meta.is_dir();
        let size = if meta.is_file() { Some(meta.len()) } else { None };
        entries.push(serde_json::json!({
            "name": name,
            "is_dir": is_dir,
            "size": size,
        }));
    }
    Ok(entries)
}

pub fn read(path: &str) -> ToolResult {
    match read_impl(path) {
        Ok(content) => ok_result(serde_json::json!({ "content": content })),
        Err(e) => err_result(&e.to_string()),
    }
}

fn read_impl(path: &str) -> Result<String, ToolError> {
    let p = resolve_in_workspace(path)?;
    let content = fs::read_to_string(&p)?;
    Ok(content)
}

pub fn stat(path: &str) -> ToolResult {
    match stat_impl(path) {
        Ok(info) => ok_result(info),
        Err(e) => err_result(&e.to_string()),
    }
}

fn stat_impl(path: &str) -> Result<serde_json::Value, ToolError> {
    let p = resolve_in_workspace(path)?;
    let meta = fs::metadata(&p)?;
    Ok(serde_json::json!({
        "path": p.to_string_lossy(),
        "is_dir": meta.is_dir(),
        "is_file": meta.is_file(),
        "len": meta.len(),
        "modified": meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs())),
    }))
}

pub fn write(path: &str, content: &str) -> ToolResult {
    match write_impl(path, content) {
        Ok(Some((info, undo))) => ok_result_with_undo(info, undo),
        Ok(None) => ok_result(serde_json::json!({ "written": path })),
        Err(e) => err_result(&e.to_string()),
    }
}

fn write_impl(path: &str, content: &str) -> Result<Option<(serde_json::Value, UndoAction)>, ToolError> {
    let p = path_under_workspace(path)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut undo = None;
    if p.exists() {
        ensure_app_data_dir()?;
        let backup_path = undo_dir().join(format!("write_{}.bak", Uuid::new_v4()));
        fs::create_dir_all(undo_dir())?;
        fs::copy(&p, &backup_path)?;
        undo = Some(UndoAction::FsWrite {
            path: p.to_string_lossy().to_string(),
            backup_path: backup_path.to_string_lossy().to_string(),
        });
    }
    fs::write(&p, content)?;
    Ok(undo.map(|u| (serde_json::json!({ "written": path, "undo_available": true }), u)))
}

pub fn append(path: &str, content: &str) -> ToolResult {
    match append_impl(path, content) {
        Ok(()) => ok_result(serde_json::json!({ "appended": path })),
        Err(e) => err_result(&e.to_string()),
    }
}

fn append_impl(path: &str, content: &str) -> Result<(), ToolError> {
    let p = resolve_in_workspace(path)?;
    let mut f = fs::OpenOptions::new().append(true).open(&p)?;
    use std::io::Write;
    f.write_all(content.as_bytes())?;
    Ok(())
}

pub fn copy(src: &str, dst: &str) -> ToolResult {
    match copy_impl(src, dst) {
        Ok(()) => ok_result(serde_json::json!({ "copied": src, "to": dst })),
        Err(e) => err_result(&e.to_string()),
    }
}

fn copy_impl(src: &str, dst: &str) -> Result<(), ToolError> {
    let src_p = resolve_in_workspace(src)?;
    let dst_p = path_under_workspace(dst)?;
    if let Some(parent) = dst_p.parent() {
        fs::create_dir_all(parent)?;
    }
    if src_p.is_dir() {
        copy_dir_recursive(&src_p, &dst_p)?;
    } else {
        fs::copy(&src_p, &dst_p)?;
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), ToolError> {
    fs::create_dir_all(dst)?;
    for e in fs::read_dir(src)? {
        let e = e?;
        let name = e.file_name();
        let src_path = src.join(&name);
        let dst_path = dst.join(&name);
        if e.metadata()?.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

pub fn move_(src: &str, dst: &str) -> ToolResult {
    match move_impl(src, dst) {
        Ok(Some((info, undo))) => ok_result_with_undo(info, undo),
        Ok(None) => ok_result(serde_json::json!({ "moved": src, "to": dst })),
        Err(e) => err_result(&e.to_string()),
    }
}

fn move_impl(src: &str, dst: &str) -> Result<Option<(serde_json::Value, UndoAction)>, ToolError> {
    let src_p = resolve_in_workspace(src)?;
    let dst_p = path_under_workspace(dst)?;
    if let Some(parent) = dst_p.parent() {
        fs::create_dir_all(parent)?;
    }
    ensure_app_data_dir()?;
    let backup_path = undo_dir().join(format!("move_{}.bak", Uuid::new_v4()));
    fs::create_dir_all(undo_dir())?;
    if src_p.is_dir() {
        copy_dir_recursive(&src_p, &backup_path)?;
    } else {
        fs::copy(&src_p, &backup_path)?;
    }
    let undo = UndoAction::FsMove {
        src: src_p.to_string_lossy().to_string(),
        dst: dst_p.to_string_lossy().to_string(),
        backup_path: backup_path.to_string_lossy().to_string(),
    };
    fs::rename(&src_p, &dst_p)?;
    Ok(Some((
        serde_json::json!({ "moved": src, "to": dst, "undo_available": true }),
        undo,
    )))
}

pub fn rename(src: &str, dst: &str) -> ToolResult {
    move_(src, dst)
}

pub fn delete(path: &str) -> ToolResult {
    match delete_impl(path) {
        Ok(Some((info, undo))) => ok_result_with_undo(info, undo),
        Ok(None) => ok_result(serde_json::json!({ "trashed": path })),
        Err(e) => err_result(&e.to_string()),
    }
}

fn delete_impl(path: &str) -> Result<Option<(serde_json::Value, UndoAction)>, ToolError> {
    let p = resolve_in_workspace(path)?;
    ensure_app_data_dir()?;
    let backup_path = undo_dir().join(format!("delete_{}.bak", Uuid::new_v4()));
    fs::create_dir_all(undo_dir())?;
    if p.is_dir() {
        copy_dir_recursive(&p, &backup_path)?;
    } else {
        fs::copy(&p, &backup_path)?;
    }
    let undo = UndoAction::FsDelete {
        path: p.to_string_lossy().to_string(),
        backup_path: backup_path.to_string_lossy().to_string(),
    };
    trash::delete(&p).map_err(|e| ToolError::Download(e.to_string()))?;
    Ok(Some((
        serde_json::json!({ "trashed": path, "undo_available": true }),
        undo,
    )))
}
