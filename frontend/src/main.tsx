import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { startRefreshTimer } from "./stores/authStore";
import "./styles/tailwind.css";

startRefreshTimer();

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
			<App />
		</ThemeProvider>
	</React.StrictMode>,
);
