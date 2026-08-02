/**
 * web-main — PiDeck Web 服务 React 入口（A2）。
 * 独立于主窗口 renderer；通过 /api/* 与主进程 WebServiceManager 通信。
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WebChatApp } from "./web/WebChatApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WebChatApp />
  </StrictMode>,
);
