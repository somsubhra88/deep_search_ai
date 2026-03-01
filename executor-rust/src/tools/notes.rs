use super::{err_result, ok_result, ToolError, ToolResult};
use crate::config::{app_data_dir, ensure_app_data_dir};
use std::fs;
use std::path::PathBuf;
use std::path::Path;

fn notes_dir() -> PathBuf {
    let mut p = app_data_dir();
    p.push("notes");
    p
}

fn note_path(title: &str, folder: Option<&str>) -> PathBuf {
    let mut base = notes_dir();
    if let Some(f) = folder {
        base.push(sanitize_folder(f));
    }
    base.push(sanitize_title(title));
    base.set_extension("md");
    base
}

fn sanitize_folder(s: &str) -> String {
    let cleaned: String = s.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let cleaned = cleaned.trim_matches('_').replace("..", "_");
    if cleaned.is_empty() { "default".to_string() } else { cleaned }
}

fn sanitize_title(s: &str) -> String {
    let cleaned: String = s.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '_' })
        .collect();
    let cleaned = cleaned.trim().replace("..", "_");
    if cleaned.is_empty() { "untitled".to_string() } else { cleaned[..cleaned.len().min(200)].to_string() }
}

pub fn create(title: &str, content: &str, folder: Option<&str>) -> ToolResult {
    match create_impl(title, content, folder) {
        Ok(info) => ok_result(info),
        Err(e) => err_result(&e.to_string()),
    }
}

fn create_impl(title: &str, content: &str, folder: Option<&str>) -> Result<serde_json::Value, ToolError> {
    ensure_app_data_dir()?;
    let path = note_path(title, folder);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, content)?;
    Ok(serde_json::json!({
        "title": title,
        "path": path.to_string_lossy(),
        "folder": folder,
    }))
}

pub fn update(title: &str, content: &str, folder: Option<&str>) -> ToolResult {
    match update_impl(title, content, folder) {
        Ok(info) => ok_result(info),
        Err(e) => err_result(&e.to_string()),
    }
}

fn update_impl(title: &str, content: &str, folder: Option<&str>) -> Result<serde_json::Value, ToolError> {
    let path = note_path(title, folder);
    fs::write(&path, content)?;
    Ok(serde_json::json!({
        "title": title,
        "path": path.to_string_lossy(),
        "folder": folder,
    }))
}

pub fn search(query: &str, folder: Option<&str>) -> super::ToolResult {
    match search_impl(query, folder) {
        Ok(matches) => super::ok_result(serde_json::json!({ "matches": matches })),
        Err(e) => super::err_result(&e.to_string()),
    }
}

fn search_impl(query: &str, folder: Option<&str>) -> Result<Vec<serde_json::Value>, ToolError> {
    ensure_app_data_dir()?;
    let base = notes_dir();
    let search_base = if let Some(f) = folder {
        base.join(sanitize_folder(f))
    } else {
        base.clone()
    };
    if !search_base.exists() {
        return Ok(vec![]);
    }
    let q_lower = query.to_lowercase();
    let mut matches = Vec::new();
    walk_notes(&search_base, &base, &q_lower, &mut matches)?;
    Ok(matches)
}

fn walk_notes(
    dir: &Path,
    base: &Path,
    query: &str,
    out: &mut Vec<serde_json::Value>,
) -> Result<(), ToolError> {
    for e in fs::read_dir(dir)? {
        let e = e?;
        let path = e.path();
        if path.is_dir() {
            walk_notes(&path, base, query, out)?;
        } else if path.extension().map_or(false, |x| x == "md") {
            let content = fs::read_to_string(&path).unwrap_or_default();
            let title = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
            let rel = path.strip_prefix(base).ok().map(|p| p.to_string_lossy().to_string());
            if title.to_lowercase().contains(query)
                || content.to_lowercase().contains(query)
            {
                out.push(serde_json::json!({
                    "title": title,
                    "path": path.to_string_lossy(),
                    "relative_path": rel,
                    "snippet": snippet(&content, query),
                }));
            }
        }
    }
    Ok(())
}

fn snippet(content: &str, query: &str) -> Option<String> {
    let pos = content.to_lowercase().find(query)?;
    let start = pos.saturating_sub(50).max(0);
    let end = (pos + query.len() + 50).min(content.len());
    let s = &content[start..end];
    Some(format!("...{}...", s.replace('\n', " ")))
}
