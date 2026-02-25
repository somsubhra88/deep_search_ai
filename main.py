import os
from dotenv import load_dotenv

load_dotenv()

from typing import List, Optional, Literal
from pydantic import BaseModel
from datetime import date
from dateutil.parser import parse
from langchain_openai import ChatOpenAI
from concurrent.futures import ThreadPoolExecutor, as_completed
from serpapi import GoogleSearch
from langgraph.graph import StateGraph, END

ContentType = Literal["text", "image", "video"]

class SearchState(BaseModel):
    query: str
    start_date: date
    end_date: date
    content_types: List[ContentType]
    deep_search: bool

    expanded_queries: Optional[List[str]] = None
    max_results_per_type: int = 10

    raw_results: Optional[list] = None
    filtered_results: Optional[list] = None
    classified_results: Optional[list] = None


def build_search_plan(state: SearchState) -> SearchState:
    # Deep search = query expansion
    expanded_queries = [state.query]

    if state.deep_search:
        expanded_queries += [
            f"{state.query} site:reddit.com",
            f"{state.query} site:twitter.com",
            f"{state.query} forum",
            f"{state.query} review",
        ]

    state.expanded_queries = expanded_queries
    state.raw_results = None
    return state


def _serpapi_date_tbs(start: date, end: date) -> str:
    # Google "tbs" custom date range format used by SerpAPI
    # Example: cdr:1,cd_min:07/01/2024,cd_max:07/31/2024
    return f"cdr:1,cd_min:{start.strftime('%m/%d/%Y')},cd_max:{end.strftime('%m/%d/%Y')}"


def serpapi_search_one(query: str, ctype: ContentType, state: SearchState) -> list:
    api_key = os.getenv("SERPAPI_API_KEY")
    if not api_key:
        raise RuntimeError("SERPAPI_API_KEY is not set. Put it in .env")

    params = {
        "engine": "google",
        "q": query,
        "api_key": api_key,
        # Locale is optional; you can set SERPAPI_GL/SERPAPI_HL in .env if you want
        "gl": os.getenv("SERPAPI_GL", "jp"),
        "hl": os.getenv("SERPAPI_HL", "en"),
        # Date range filter (still keep local filter as a safeguard)
        "tbs": _serpapi_date_tbs(state.start_date, state.end_date),
        "num": str(state.max_results_per_type),
        # SafeSearch ON by default; set SERPAPI_SAFE=off if you explicitly want it off.
        "safe": os.getenv("SERPAPI_SAFE", "active"),
    }

    # Content type mapping
    if ctype == "image":
        params["tbm"] = "isch"
    elif ctype == "video":
        params["tbm"] = "vid"

    data = GoogleSearch(params).get_dict()

    results = []

    if ctype == "text":
        for item in data.get("organic_results", [])[: state.max_results_per_type]:
            results.append(
                {
                    "query": query,
                    "type": ctype,
                    "title": item.get("title"),
                    "snippet": item.get("snippet") or item.get("snippet_highlighted_words"),
                    "published_date": item.get("date"),
                    "url": item.get("link"),
                    "source": "serpapi/google",
                }
            )

    elif ctype == "image":
        for item in data.get("images_results", [])[: state.max_results_per_type]:
            results.append(
                {
                    "query": query,
                    "type": ctype,
                    "title": item.get("title"),
                    "snippet": item.get("source"),
                    "published_date": item.get("date"),
                    "url": item.get("link") or item.get("original"),
                    "thumbnail": item.get("thumbnail"),
                    "source": "serpapi/google_images",
                }
            )

    elif ctype == "video":
        for item in data.get("video_results", [])[: state.max_results_per_type]:
            results.append(
                {
                    "query": query,
                    "type": ctype,
                    "title": item.get("title"),
                    "snippet": item.get("snippet") or item.get("description"),
                    "published_date": item.get("date"),
                    "url": item.get("link"),
                    "source": "serpapi/google_videos",
                }
            )

    return results


def search_content(state: SearchState) -> SearchState:
    if not state.expanded_queries:
        state.raw_results = []
        return state

    tasks = []
    results: list = []

    # Parallelize across (expanded_query × content_type)
    with ThreadPoolExecutor(max_workers=int(os.getenv("SEARCH_MAX_WORKERS", "8"))) as ex:
        for q in state.expanded_queries:
            for ctype in state.content_types:
                tasks.append(ex.submit(serpapi_search_one, q, ctype, state))

        for fut in as_completed(tasks):
            try:
                results.extend(fut.result())
            except Exception as e:
                # Keep going even if one branch fails
                results.append(
                    {
                        "query": "(error)",
                        "type": "text",
                        "title": "Search error",
                        "snippet": str(e),
                        "published_date": None,
                        "url": None,
                        "source": "error",
                    }
                )

    state.raw_results = results
    return state


def filter_by_date_and_type(state: SearchState) -> SearchState:
    filtered = []

    for r in state.raw_results or []:
        # If type mismatches, skip
        if r.get("type") not in state.content_types:
            continue

        # Prefer explicit published_date when present
        d = r.get("published_date")
        if d:
            try:
                pub_date = parse(str(d)).date()
                if not (state.start_date <= pub_date <= state.end_date):
                    continue
            except Exception:
                # If date parsing fails, keep it (the API query already constrained the date range)
                pass

        filtered.append(r)

    state.filtered_results = filtered
    return state



llm = ChatOpenAI(
    model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
    temperature=float(os.getenv("OPENAI_TEMPERATURE", "0")),
)

def classify_content(state: SearchState) -> SearchState:
    classified = []

    for r in (state.filtered_results or []):
        prompt = f"""
        You are a strict content moderation classifier.
        
        Task: Label the content as exactly one of the following tokens:
        - ADULT  (pornographic / explicit sexual content, nudity intended for sexual arousal)
        - NON_ADULT (everything else, including academic/medical, news, art, biology, sex education)
        
        Rules:
        - Use ADULT only when you have high confidence it is pornographic/explicit.
        - If unsure, output NON_ADULT.
        - Output ONLY the label token, nothing else.
        
        Title: {r.get('title')}
        Snippet: {r.get('snippet')}
        Source: {r.get('source')}
        URL: {r.get('url')}
        """

        label = (llm.invoke(prompt).content or "").strip().upper()
        # Normalize to the two allowed labels
        if label not in {"ADULT", "NON_ADULT"}:
            label = "NON_ADULT"

        r["classification"] = label
        classified.append(r)

    state.classified_results = classified
    return state




graph = StateGraph(SearchState)

graph.add_node("build_plan", build_search_plan)
graph.add_node("search", search_content)
graph.add_node("filter", filter_by_date_and_type)
graph.add_node("classify", classify_content)

graph.set_entry_point("build_plan")

graph.add_edge("build_plan", "search")
graph.add_edge("search", "filter")
graph.add_edge("filter", "classify")
graph.add_edge("classify", END)

app = graph.compile()

state = SearchState(
    query="Personalized Page Rank",
    start_date=date(2024, 7, 1),
    end_date=date(2024, 7, 31),
    content_types=["text"],
    deep_search=True,
    max_results_per_type=5,
)

result = app.invoke(state)

# LangGraph returns a plain dict state by default
classified_results = result.get("classified_results", [])
for r in classified_results:
    print(r.get("classification"), r.get("type"), r.get("title"))
