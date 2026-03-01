use super::{err_result, ok_result, ToolError, ToolResult};
use crate::policy::path_under_workspace;
use std::process::Command;

pub fn run(cmd: &str, cwd: Option<&str>) -> ToolResult {
    match run_impl(cmd, cwd) {
        Ok(info) => ok_result(info),
        Err(e) => err_result(&e.to_string()),
    }
}

const MAX_CMD_LEN: usize = 8192;

fn run_impl(cmd: &str, cwd: Option<&str>) -> Result<serde_json::Value, ToolError> {
    if cmd.len() > MAX_CMD_LEN {
        return Err(ToolError::Download(format!("command too long ({} chars, max {})", cmd.len(), MAX_CMD_LEN)));
    }
    #[cfg(target_os = "windows")]
    let mut cmd_builder = {
        let mut c = Command::new("cmd");
        c.args(["/C", cmd]);
        c
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd_builder = {
        let mut c = Command::new("sh");
        c.args(["-c", cmd]);
        c
    };

    cmd_builder
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    if let Some(c) = cwd {
        let cwd_path = path_under_workspace(c)?;
        cmd_builder.current_dir(&cwd_path);
    }

    let output = cmd_builder
        .output()
        .map_err(|e| ToolError::Download(e.to_string()))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    Ok(serde_json::json!({
        "exit_code": output.status.code().unwrap_or(-1),
        "stdout": stdout,
        "stderr": stderr,
    }))
}
