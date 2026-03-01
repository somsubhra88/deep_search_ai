//! Policy engine: R0–R3 risk scoring and workspace sandbox.

use crate::models::ToolRequest;
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Risk levels: R0 (lowest) to R3 (highest).
/// R0/R1: auto-allow if rule matches.
/// R2: session approval if no rule.
/// R3: always ask.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RiskLevel {
    R0 = 0,
    R1 = 1,
    R2 = 2,
    R3 = 3,
}

#[derive(Debug, Error)]
pub enum PolicyError {
    #[error("path outside workspace: {0}")]
    PathOutsideWorkspace(String),
    #[error("path traversal or symlink escape: {0}")]
    PathTraversal(String),
}

/// Expand ~ to HOME in path. Leaves path unchanged if no ~ or HOME unset.
fn expand_tilde(path: &str) -> PathBuf {
    let path = path.trim();
    if path == "~" {
        return std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from(path));
    }
    if path.starts_with("~/") || path.starts_with("~\\") {
        if let Ok(home) = std::env::var("HOME") {
            let rest = path[2..].trim_start_matches(|c| c == '/' || c == '\\');
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(path)
}

/// Workspace roots that are allowlisted. Paths must be under one of these.
pub fn workspace_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        roots.push(PathBuf::from(&home));
    }
    if let Ok(cwd) = std::env::current_dir() {
        if !roots.contains(&cwd) {
            roots.push(cwd);
        }
    }
    roots
}

/// Resolve path to canonical form and ensure it's under a workspace root.
pub fn resolve_in_workspace(path: &str) -> Result<PathBuf, PolicyError> {
    let expanded = expand_tilde(path);
    let p = Path::new(&expanded);
    let canonical = p
        .canonicalize()
        .map_err(|_| PolicyError::PathOutsideWorkspace(path.to_string()))?;

    for root in workspace_roots() {
        if let Ok(root_canon) = root.canonicalize() {
            if canonical.starts_with(&root_canon) {
                return Ok(canonical);
            }
        }
    }

    Err(PolicyError::PathOutsideWorkspace(path.to_string()))
}

/// Check path is under workspace (no canonicalization; for paths that may not exist yet).
pub fn path_under_workspace(path: &str) -> Result<PathBuf, PolicyError> {
    let p = expand_tilde(path);
    let resolved = if p.is_relative() {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(p)
    } else {
        p
    };
    let normalized: PathBuf = resolved.components().fold(PathBuf::new(), |mut acc, c| {
        match c {
            std::path::Component::ParentDir => {
                acc.pop();
            }
            std::path::Component::CurDir => {}
            std::path::Component::Prefix(px) => {
                acc = PathBuf::from(px.as_os_str());
            }
            std::path::Component::RootDir => {
                acc = PathBuf::from("/");
            }
            _ => acc.push(c),
        }
        acc
    });

    for root in workspace_roots() {
        let root_canon = root.canonicalize().unwrap_or(root.clone());
        if normalized.starts_with(&root_canon) {
            return Ok(normalized);
        }
    }
    Err(PolicyError::PathOutsideWorkspace(path.to_string()))
}

/// Get risk level for a tool request.
pub fn risk_level(tool: &ToolRequest) -> RiskLevel {
    use crate::models::ToolRequest::*;
    match tool {
        FsList { .. } | FsRead { .. } | FsStat { .. } => RiskLevel::R0,
        FsAppend { .. } | FsCopy { .. } | FsMove { .. } | FsRename { .. } | NotesCreate { .. }
        | NotesUpdate { .. } => RiskLevel::R1,
        FsWrite { .. } | FsDelete { .. } | ArchiveExtract { .. } => RiskLevel::R2,
        NetDownload { .. } | ShellRun { .. } => RiskLevel::R3,
        NotesSearch { .. } | ClipboardRead | ClipboardWrite { .. } => RiskLevel::R0,
    }
}

/// Tool name for fingerprinting.
pub fn tool_name(tool: &ToolRequest) -> &'static str {
    use crate::models::ToolRequest::*;
    match tool {
        FsList { .. } => "fs.list",
        FsRead { .. } => "fs.read",
        FsStat { .. } => "fs.stat",
        FsWrite { .. } => "fs.write",
        FsAppend { .. } => "fs.append",
        FsCopy { .. } => "fs.copy",
        FsMove { .. } => "fs.move",
        FsRename { .. } => "fs.rename",
        FsDelete { .. } => "fs.delete",
        NetDownload { .. } => "net.download",
        ArchiveExtract { .. } => "archive.extract",
        ShellRun { .. } => "shell.run",
        NotesCreate { .. } => "notes.create",
        NotesUpdate { .. } => "notes.update",
        NotesSearch { .. } => "notes.search",
        ClipboardRead => "clipboard.read",
        ClipboardWrite { .. } => "clipboard.write",
    }
}
