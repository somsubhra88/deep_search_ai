use super::{err_result, ok_result, ToolError, ToolResult};
use std::io::Write;
use std::process::{Command, Stdio};

pub fn read() -> ToolResult {
    match read_impl() {
        Ok(content) => ok_result(serde_json::json!({ "content": content })),
        Err(e) => err_result(&e.to_string()),
    }
}

fn read_impl() -> Result<String, ToolError> {
    #[cfg(target_os = "macos")]
    {
        let out = Command::new("pbpaste")
            .output()
            .map_err(|e| ToolError::Download(e.to_string()))?;
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let out = Command::new("powershell")
            .args(["-Command", "Get-Clipboard"])
            .output()
            .map_err(|e| ToolError::Download(e.to_string()))?;
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let out = Command::new("wl-paste")
            .arg("--no-newline")
            .output()
            .or_else(|_| {
                Command::new("xclip")
                    .args(["-selection", "clipboard", "-o"])
                    .output()
            })
            .or_else(|_| {
                Command::new("xsel")
                    .args(["--clipboard", "--output"])
                    .output()
            })
            .map_err(|e| ToolError::Download(e.to_string()))?;
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    }
}

pub fn write(content: &str) -> ToolResult {
    match write_impl(content) {
        Ok(()) => ok_result(serde_json::json!({ "written": true })),
        Err(e) => err_result(&e.to_string()),
    }
}

fn write_impl(content: &str) -> Result<(), ToolError> {
    #[cfg(target_os = "macos")]
    {
        let mut child = Command::new("pbcopy")
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| ToolError::Download(e.to_string()))?;
        child.stdin.as_mut().unwrap().write_all(content.as_bytes())?;
        child.wait().map_err(|e| ToolError::Download(e.to_string()))?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        let mut child = Command::new("powershell")
            .args(["-Command", "$input | Set-Clipboard"])
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| ToolError::Download(e.to_string()))?;
        child.stdin.as_mut().unwrap().write_all(content.as_bytes())?;
        child.wait().map_err(|e| ToolError::Download(e.to_string()))?;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let mut child = Command::new("wl-copy")
            .stdin(Stdio::piped())
            .spawn()
            .or_else(|_| {
                Command::new("xclip")
                    .args(["-selection", "clipboard"])
                    .stdin(Stdio::piped())
                    .spawn()
            })
            .or_else(|_| {
                Command::new("xsel")
                    .args(["--clipboard", "--input"])
                    .stdin(Stdio::piped())
                    .spawn()
            })
            .map_err(|e| ToolError::Download(e.to_string()))?;
        if let Some(ref mut stdin) = child.stdin {
            stdin.write_all(content.as_bytes())?;
        }
        child.wait().map_err(|e| ToolError::Download(e.to_string()))?;
        Ok(())
    }
}
