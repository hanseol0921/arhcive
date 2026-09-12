import { useEffect, useMemo, useRef, useState } from "react";
import "./ScraperControl.css";

const LOCAL_SERVER = "http://127.0.0.1:8765";

function ScraperControl() {
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState({
    status: "idle",
    running: false,
    awaitingContinue: false,
    exitCode: null,
    logs: [],
  });
  const [message, setMessage] = useState("");
  const logRef = useRef(null);

  async function refresh() {
    try {
      const response = await fetch(`${LOCAL_SERVER}/status`, { cache: "no-store" });
      if (!response.ok) throw new Error("연결 실패");
      const data = await response.json();
      setSnapshot(data);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 1200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [snapshot.logs]);

  async function runAction(action) {
    setMessage("");
    try {
      const response = await fetch(`${LOCAL_SERVER}/${action}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || "요청 실패");
      setSnapshot(data);
      setMessage(data.message || "처리했습니다.");
      setConnected(true);
    } catch (error) {
      setMessage(error.message);
      refresh();
    }
  }

  const statusText = useMemo(() => {
    if (!connected) return "로컬 연결 꺼짐";
    if (snapshot.awaitingContinue) return "브라우저 조작 대기 중";
    if (snapshot.running) return "스크래퍼 실행 중";
    if (snapshot.status === "finished") return "최근 작업 완료";
    if (snapshot.status === "error") return "최근 작업 오류";
    return "실행 대기";
  }, [connected, snapshot]);

  return (
    <main className="scraper-control-page">
      <header className="scraper-control-header">
        <button type="button" onClick={() => { window.location.href = "/admin"; }}>← 관리자 홈</button>
        <div>
          <small>LOCAL SCRAPER</small>
          <h1>위버스 게시글 가져오기</h1>
          <p>기존 Python 스크래퍼를 그대로 실행하고 진행 로그를 확인합니다.</p>
        </div>
      </header>

      <section className="scraper-control-card">
        <div className={`scraper-control-status ${connected ? snapshot.status : "offline"}`}>
          <span />
          <strong>{statusText}</strong>
        </div>

        {!connected && (
          <div className="scraper-control-offline">
            <strong>먼저 로컬 연결을 켜주세요.</strong>
            <p><code>weverse_archive</code> 폴더의 <code>스크래퍼_관리자_열기.vbs</code>를 더블클릭하면 됩니다.</p>
          </div>
        )}

        <div className="scraper-control-actions">
          <button type="button" disabled={!connected || snapshot.running} onClick={() => runAction("start")}>최근 게시글 확인 시작</button>
          <button type="button" className="continue" disabled={!connected || !snapshot.running} onClick={() => runAction("continue")}>브라우저 이동 완료 · 계속</button>
          <button type="button" className="stop" disabled={!connected || !snapshot.running} onClick={() => {
            if (window.confirm("실행 중인 스크래퍼를 중지할까요?")) runAction("stop");
          }}>중지</button>
        </div>

        <ol className="scraper-control-guide">
          <li>시작을 누르면 기존 스크래퍼의 Chrome 창이 열립니다.</li>
          <li>Chrome에서 원하는 그룹 → 리우 게시글 탭으로 이동합니다.</li>
          <li>이 화면으로 돌아와 ‘브라우저 이동 완료 · 계속’을 누릅니다.</li>
        </ol>

        {message && <div className="scraper-control-message">{message}</div>}
        <pre className="scraper-control-log" ref={logRef}>
          {snapshot.logs?.length ? snapshot.logs.join("\n") : "아직 실행 로그가 없습니다."}
        </pre>
      </section>
    </main>
  );
}

export default ScraperControl;
