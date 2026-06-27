import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PromptFold, context handoff for AI chats",
  description:
    "One click turns a long AI chat (Claude, ChatGPT, Gemini, and more) into a structured brief you can carry to a fresh chat, another chatbot, or a teammate, losing nothing that matters.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased text-neutral-900 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
