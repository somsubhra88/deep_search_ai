//! Deep Search Executor - local agent tools server.

mod approval;
mod audit;
mod config;
mod db;
mod models;
mod policy;
mod rollback;
mod scheduler;
mod tools;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::sse::{Event, Sse},
    routing::{delete, get, post},
    Json, Router,
};
use models::*;
use policy::{risk_level, tool_name};
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    db: Arc<db::Db>,
    approvals: Arc<approval::ApprovalStore>,
    rollback: Arc<rollback::RollbackStore>,
    scheduler: Arc<scheduler::SchedulerDb>,
    events: broadcast::Sender<RunEvent>,
}

#[derive(Clone, serde::Serialize)]
struct RunEvent {
    run_id: String,
    #[serde(rename = "type")]
    event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
}

fn path_prefix_for_tool(tool: &ToolRequest) -> Option<&str> {
    match tool {
        ToolRequest::FsList { path } => Some(path.as_str()),
        ToolRequest::FsRead { path } => Some(path.as_str()),
        ToolRequest::FsStat { path } => Some(path.as_str()),
        ToolRequest::FsWrite { path, .. } => Some(path.as_str()),
        ToolRequest::FsAppend { path, .. } => Some(path.as_str()),
        ToolRequest::FsCopy { src, .. } => Some(src.as_str()),
        ToolRequest::FsMove { src, .. } => Some(src.as_str()),
        ToolRequest::FsRename { src, .. } => Some(src.as_str()),
        ToolRequest::FsDelete { path } => Some(path.as_str()),
        ToolRequest::NetDownload { dst_path, .. } => Some(dst_path.as_str()),
        ToolRequest::ArchiveExtract { archive_path, .. } => Some(archive_path.as_str()),
        ToolRequest::ShellRun { cwd, .. } => cwd.as_deref(),
        _ => None,
    }
}

fn domain_for_tool(tool: &ToolRequest) -> Option<String> {
    match tool {
        ToolRequest::NetDownload { url, .. } => url.parse::<url::Url>().ok().and_then(|u| u.host_str().map(String::from)),
        _ => None,
    }
}

async fn execute_single(
    state: &AppState,
    run_id: &str,
    tool: &ToolRequest,
    dry_run: bool,
    context: &Option<SearchContext>,
) -> Result<tools::ToolResult, (StatusCode, String)> {
    let tn = tool_name(tool);
    let risk = risk_level(tool) as u8;

    if !dry_run {
        let path_prefix = path_prefix_for_tool(tool);
        let domain = domain_for_tool(tool);
        if let Some(rule) = state.db.find_matching_rule(tn, path_prefix, domain.as_deref(), None)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        {
            match rule.decision {
                RuleDecision::Deny => {
                    let _ = state.events.send(RunEvent {
                        run_id: run_id.to_string(),
                        event_type: "denied".into(),
                        data: Some(serde_json::json!({ "reason": "rule" })),
                    });
                    return Err((StatusCode::FORBIDDEN, "Action denied by rule".to_string()));
                }
                RuleDecision::RequireApproval | RuleDecision::Allow => {
                    if (rule.risk_level_max as u8) < risk {
                        let (approval_id, rx) = state.approvals.create(run_id, tool.clone());
                        let _ = state.events.send(RunEvent {
                            run_id: run_id.to_string(),
                            event_type: "approval_required".into(),
                            data: Some(serde_json::json!({
                                "approval_id": approval_id,
                                "tool": tn,
                                "risk_level": risk,
                            })),
                        });
                        let result = rx.await.map_err(|_| {
                            (StatusCode::GATEWAY_TIMEOUT, "Approval timed out".to_string())
                        })?;
                        if matches!(result, approval::ApprovalResult::Denied) {
                            return Err((StatusCode::FORBIDDEN, "Approval denied".to_string()));
                        }
                    } else if matches!(rule.decision, RuleDecision::Allow) {
                        state.db.touch_rule(&rule.id).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                    }
                }
            }
        } else if risk >= 2 {
            let (approval_id, rx) = state.approvals.create(run_id, tool.clone());
            let _ = state.events.send(RunEvent {
                run_id: run_id.to_string(),
                event_type: "approval_required".into(),
                data: Some(serde_json::json!({
                    "approval_id": approval_id,
                    "tool": tn,
                    "risk_level": risk,
                })),
            });
            let result = rx.await.map_err(|_| {
                (StatusCode::GATEWAY_TIMEOUT, "Approval timed out".to_string())
            })?;
            if matches!(result, approval::ApprovalResult::Denied) {
                return Err((StatusCode::FORBIDDEN, "Approval denied".to_string()));
            }
        }
    }

    let _ = state.events.send(RunEvent {
        run_id: run_id.to_string(),
        event_type: "tool_start".into(),
        data: Some(serde_json::to_value(tool).unwrap_or_default()),
    });

    if !dry_run {
        let audit = audit::AuditLog::new(run_id).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let mut audit_data = serde_json::json!({ "event": "tool_execute", "tool": tn, "run_id": run_id });
        if let Some(ctx) = context {
            audit_data["context"] = serde_json::to_value(ctx).unwrap_or_default();
        }
        audit.append(&audit_data).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    let result = tools::execute(tool, dry_run);

    let _ = state.events.send(RunEvent {
        run_id: run_id.to_string(),
        event_type: "tool_result".into(),
        data: Some(serde_json::to_value(&result).unwrap_or_default()),
    });

    Ok(result)
}

async fn execute_tool(
    State(state): State<AppState>,
    Json(req): Json<ExecuteRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let run_id = req.run_id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
    let dry_run = req.dry_run;
    let context = req.context.clone();

    let tools_list: Vec<ToolRequest> = if let Some(ref chain) = req.tools {
        chain.clone()
    } else if let Some(ref t) = req.tool {
        vec![t.clone()]
    } else {
        return Err((StatusCode::BAD_REQUEST, "Missing 'tool' or 'tools'".to_string()));
    };

    let mut results = Vec::new();
    for tool in &tools_list {
        let result = execute_single(&state, &run_id, tool, dry_run, &context).await?;
        if let Some(ref undo) = result.undo {
            state.rollback.push(&run_id, undo.clone());
        }
        results.push(result);
    }

    let response = if results.len() == 1 {
        serde_json::json!({
            "run_id": run_id,
            "result": results.into_iter().next().unwrap(),
            "context": context,
        })
    } else {
        serde_json::json!({
            "run_id": run_id,
            "results": results,
            "context": context,
        })
    };

    Ok(Json(response))
}

async fn approval_respond(
    State(state): State<AppState>,
    Json(req): Json<ApprovalRespondRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let responded = state.approvals.respond(&req.approval_id, req.decision.clone())
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    if let Some(resp) = responded {
        if resp.approved && req.save_rule.is_some() {
            let scope = req.save_rule.unwrap();
            let _ = state.db.create_rule(&CreateRuleRequest {
                tool_name: scope.tool_name.unwrap_or_else(|| tool_name(&resp.tool).to_string()),
                path_prefix: scope.path_prefix,
                domain: scope.domain,
                action_fingerprint: None,
                decision: RuleDecision::Allow,
                risk_level_max: Some(risk_level(&resp.tool) as u8),
            });
        }
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn runs_events(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Sse<impl futures::Stream<Item = Result<Event, axum::Error>>> {
    let mut rx = state.events.subscribe();
    let stream = async_stream::stream! {
        loop {
            match rx.recv().await {
                Ok(ev) if ev.run_id == run_id => {
                    let data = serde_json::to_string(&ev).unwrap_or_default();
                    yield Ok(Event::default().data(data));
                }
                Err(_) => break,
                _ => {}
            }
        }
    };
    Sse::new(stream)
}

async fn rules_list(State(state): State<AppState>) -> Result<Json<Vec<Rule>>, (StatusCode, String)> {
    let rules = state.db.list_rules().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rules))
}

async fn rules_create(
    State(state): State<AppState>,
    Json(req): Json<CreateRuleRequest>,
) -> Result<Json<Rule>, (StatusCode, String)> {
    let rule = state.db.create_rule(&req).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rule))
}

async fn rules_delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let ok = state.db.delete_rule(&id).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "ok": ok })))
}

async fn history_clear() -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let logs_dir = config::logs_dir();
    if logs_dir.exists() {
        for e in std::fs::read_dir(&logs_dir).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))? {
            let e = e.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            let _ = std::fs::remove_file(e.path());
        }
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(serde::Deserialize)]
struct UndoRequest {
    #[serde(default)]
    id: Option<String>,
}

async fn undo(
    State(state): State<AppState>,
    Json(req): Json<UndoRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let entry = if let Some(id) = req.id {
        state.rollback.undo_by_id(&id)
    } else {
        state.rollback.pop()
    };
    let entry = entry.ok_or((StatusCode::NOT_FOUND, "No undo available".to_string()))?;
    let cmd = entry.action.restore_command();
    tokio::task::spawn_blocking(move || {
        let _ = std::process::Command::new("sh")
            .args(["-c", &cmd])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
    });
    Ok(Json(serde_json::json!({
        "ok": true,
        "undo_id": entry.id,
        "restore_started": true,
    })))
}

async fn undo_list(State(state): State<AppState>) -> Json<Vec<rollback::UndoEntry>> {
    Json(state.rollback.list())
}

#[derive(serde::Deserialize)]
struct ScheduleRequest {
    pub tool: ToolRequest,
    pub run_at: String,
    #[serde(default)]
    pub cron: Option<String>,
}

async fn schedule_create(
    State(state): State<AppState>,
    Json(req): Json<ScheduleRequest>,
) -> Result<Json<scheduler::ScheduledTask>, (StatusCode, String)> {
    let task = state
        .scheduler
        .create(&req.tool, &req.run_at, req.cron.as_deref())
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    Ok(Json(task))
}

async fn schedule_list(
    State(state): State<AppState>,
) -> Result<Json<Vec<scheduler::ScheduledTask>>, (StatusCode, String)> {
    let tasks = state.scheduler.list().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(tasks))
}

async fn run_due_scheduled_tasks(state: &AppState) -> Result<(), String> {
    let tasks = state.scheduler.due_tasks()?;
    for task in tasks {
        let run_id = Uuid::new_v4().to_string();
        let _ = execute_single(state, &run_id, &task.tool, false, &None).await;
        state.scheduler.remove_due(&task.id)?;
    }
    Ok(())
}

async fn schedule_delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let ok = state.scheduler.delete(&id).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(serde_json::json!({ "ok": ok })))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::from_default_env().add_directive("deepsearch_executor=info".parse()?))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let db = Arc::new(db::Db::open()?);
    let approvals = Arc::new(approval::ApprovalStore::new());
    let rollback = Arc::new(rollback::RollbackStore::new());
    let scheduler = Arc::new(scheduler::SchedulerDb::open().map_err(|e| anyhow::anyhow!("{}", e))?);
    let (tx, _) = broadcast::channel(64);
    let state = AppState {
        db,
        approvals,
        rollback,
        scheduler,
        events: tx,
    };

    let app = Router::new()
        .route("/v1/tool/execute", post(execute_tool))
        .route("/v1/approval/respond", post(approval_respond))
        .route("/v1/runs/:run_id/events", get(runs_events))
        .route("/v1/rules", get(rules_list).post(rules_create))
        .route("/v1/rules/:id", delete(rules_delete))
        .route("/v1/history/clear", post(history_clear))
        .route("/v1/undo", post(undo))
        .route("/v1/undo/list", get(undo_list))
        .route("/v1/schedule", get(schedule_list).post(schedule_create))
        .route("/v1/schedule/:id", delete(schedule_delete))
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any))
        .with_state(state.clone());

    let state_for_scheduler = state.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
            if let Err(e) = run_due_scheduled_tasks(&state_for_scheduler).await {
                tracing::warn!("scheduler: {}", e);
            }
        }
    });

    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(7777);
    let addr: std::net::SocketAddr = format!("{}:{}", host, port)
        .parse()
        .unwrap_or_else(|_| std::net::SocketAddr::from(([127, 0, 0, 1], 7777)));
    tracing::info!("Starting executor on http://{}", addr);
    axum::serve(
        tokio::net::TcpListener::bind(addr).await?,
        app,
    )
    .await?;
    Ok(())
}
