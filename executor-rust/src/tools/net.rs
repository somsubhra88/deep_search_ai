use super::{err_result, ok_result, ToolError, ToolResult};
use crate::policy::path_under_workspace;
use std::fs;
use std::io::Write;

pub fn download(url: &str, dst_path: &str) -> ToolResult {
    match download_impl(url, dst_path) {
        Ok(info) => ok_result(info),
        Err(e) => err_result(&e.to_string()),
    }
}

fn download_impl(url: &str, dst_path: &str) -> Result<serde_json::Value, ToolError> {
    let parsed = url.parse::<url::Url>().map_err(|e| ToolError::Download(format!("invalid URL: {}", e)))?;
    match parsed.scheme() {
        "http" | "https" => {}
        scheme => return Err(ToolError::Download(format!("blocked URL scheme: {}", scheme))),
    }
    if let Some(host) = parsed.host_str() {
        if host == "localhost" || host == "127.0.0.1" || host == "::1" || host.ends_with(".local") {
            return Err(ToolError::Download("downloads from localhost/private hosts are blocked".into()));
        }
    }

    let dst_p = path_under_workspace(dst_path)?;
    if let Some(parent) = dst_p.parent() {
        fs::create_dir_all(parent).map_err(|e| ToolError::Download(e.to_string()))?;
    }

    let resp = reqwest::blocking::get(url).map_err(|e| ToolError::Download(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(ToolError::Download(format!("HTTP {}", resp.status())));
    }
    let bytes = resp.bytes().map_err(|e| ToolError::Download(e.to_string()))?;
    let mut f = fs::File::create(&dst_p).map_err(|e| ToolError::Download(e.to_string()))?;
    f.write_all(&bytes)
        .map_err(|e| ToolError::Download(e.to_string()))?;

    Ok(serde_json::json!({
        "url": url,
        "dst": dst_path,
        "bytes": bytes.len(),
    }))
}
