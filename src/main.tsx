import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { bootstrapSharedStateSync } from "@/lib/sharedStateSync";

async function main() {
	await bootstrapSharedStateSync();
	createRoot(document.getElementById("root")!).render(<App />);
}

main();
