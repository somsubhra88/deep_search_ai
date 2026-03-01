use super::{err_result, ok_result, ToolError, ToolResult};
use crate::policy::{path_under_workspace, resolve_in_workspace};
use flate2::read::GzDecoder;
use std::fs;
use std::io::{Read, Cursor};
use std::path::Path;

pub fn extract(archive_path: &str, dst_dir: &str) -> ToolResult {
    match extract_impl(archive_path, dst_dir) {
        Ok(info) => ok_result(info),
        Err(e) => err_result(&e.to_string()),
    }
}

fn extract_impl(archive_path: &str, dst_dir: &str) -> Result<serde_json::Value, ToolError> {
    let archive_p = resolve_in_workspace(archive_path)?;
    let dst_p = path_under_workspace(dst_dir)?;
    fs::create_dir_all(&dst_p)?;

    let ext = archive_p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let count = match ext {
        "gz" | "tgz" => extract_gz(&archive_p, &dst_p)?,
        "tar" => extract_tar(&archive_p, &dst_p)?,
        "zip" => extract_zip(&archive_p, &dst_p)?,
        _ => return Err(ToolError::Archive(format!("unsupported format: {}", ext))),
    };

    Ok(serde_json::json!({
        "archive": archive_path,
        "dst": dst_dir,
        "files_extracted": count,
    }))
}

fn extract_gz(archive_path: &Path, dst_dir: &Path) -> Result<u64, ToolError> {
    let f = fs::File::open(archive_path)?;
    let mut dec = GzDecoder::new(f);
    let mut buf = Vec::new();
    dec.read_to_end(&mut buf)?;
    let archive_name = archive_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("archive");
    let is_tar = archive_name.ends_with(".tar") || archive_path.to_string_lossy().ends_with(".tgz");
    if is_tar {
        extract_tar_bytes(&buf, dst_dir)
    } else {
        let out_path = dst_dir.join(archive_name);
        fs::write(&out_path, &buf)?;
        Ok(1)
    }
}

fn extract_tar(archive_path: &Path, dst_dir: &Path) -> Result<u64, ToolError> {
    let buf = fs::read(archive_path)?;
    extract_tar_bytes(&buf, dst_dir)
}

fn extract_tar_bytes(buf: &[u8], dst_dir: &Path) -> Result<u64, ToolError> {
    let mut count = 0u64;
    let mut ar = tar::Archive::new(Cursor::new(buf));
    for entry in ar.entries().map_err(|e| ToolError::Archive(e.to_string()))? {
        let mut entry = entry.map_err(|e| ToolError::Archive(e.to_string()))?;
        let path = entry.path().map_err(|e| ToolError::Archive(e.to_string()))?;
        let dest = dst_dir.join(path);
        if entry.header().entry_type().is_dir() {
            fs::create_dir_all(&dest)?;
        } else {
            if let Some(p) = dest.parent() {
                fs::create_dir_all(p)?;
            }
            entry
                .unpack(&dest)
                .map_err(|e| ToolError::Archive(e.to_string()))?;
        }
        count += 1;
    }
    Ok(count)
}

fn extract_zip(archive_path: &Path, dst_dir: &Path) -> Result<u64, ToolError> {
    let f = fs::File::open(archive_path)?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| ToolError::Archive(e.to_string()))?;
    let mut count = 0u64;
    for i in 0..zip.len() {
        let mut file = zip.by_index(i).map_err(|e| ToolError::Archive(e.to_string()))?;
        let name = file.name().to_string();
        let dest = dst_dir.join(&name);
        if file.is_dir() {
            fs::create_dir_all(&dest)?;
        } else {
            if let Some(p) = dest.parent() {
                fs::create_dir_all(p)?;
            }
            let mut out = fs::File::create(&dest)?;
            std::io::copy(&mut file, &mut out)?;
        }
        count += 1;
    }
    Ok(count)
}
