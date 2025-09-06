// src/components/MarkdownRenderer.tsx

import React, { useCallback, useState } from "react";
import { FaCopy } from "react-icons/fa";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/default.css";

const MarkdownRenderer = ({ children }) => {
  // Handle undefined or null children
  if (!children || typeof children !== 'string') {
    return <div className="text-gray-400 italic">No content to display</div>;
  }

  // Clean the content to prevent parsing errors
  const cleanContent = String(children).trim();

  if (cleanContent.length === 0) {
    return <div className="text-gray-400 italic">Empty content</div>;
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        pre: CustomPre,
        code: CustomCodeBlock,
        a: (props) => CustomLink({ children: props.children, href: props.href }),
        p: (props) => <p className="mb-4">{props.children}</p>,
        ul: (props) => <ul className="ml-8 list-disc">{props.children}</ul>,
        ol: (props) => <ol className="ml-8 list-decimal">{props.children}</ol>,
        // Add error boundaries for table elements
        table: (props) => {
          try {
            return <table className="w-full rounded-lg text-white bg-[#0d1117]">{props.children}</table>;
          } catch (error) {
            console.warn("Table rendering error:", error);
            return <div className="text-yellow-400">Table content could not be rendered</div>;
          }
        },
        thead: (props) => {
          try {
            return <thead>{props.children}</thead>;
          } catch (error) {
            console.warn("Table head rendering error:", error);
            return null;
          }
        },
        tbody: (props) => {
          try {
            return <tbody>{props.children}</tbody>;
          } catch (error) {
            console.warn("Table body rendering error:", error);
            return null;
          }
        },
        tr: (props) => {
          try {
            return <tr>{props.children}</tr>;
          } catch (error) {
            console.warn("Table row rendering error:", error);
            return null;
          }
        },
        th: (props) => {
          try {
            return <th className="rounded-lg border border-gray-700 px-4 py-2 bg-[#161b22]">{props.children}</th>;
          } catch (error) {
            console.warn("Table header rendering error:", error);
            return null;
          }
        },
        td: (props) => {
          try {
            return <td className="rounded-lg border border-gray-700 px-4 py-2">{props.children}</td>;
          } catch (error) {
            console.warn("Table cell rendering error:", error);
            return null;
          }
        },
      }}
    >
      {cleanContent}
    </ReactMarkdown>
  );
};

const CustomPre = ({ children }: { children: ReactNode }) => {
  const [isCopied, setIsCopied] = useState(false);

  const code = React.Children.toArray(children).find(isValidCustomCodeBlock);

  const language: string =
    code && code.props.className
      ? extractLanguageName(code.props.className.replace("hljs ", ""))
      : "";

  const handleCopyClick = useCallback(() => {
    if (code && React.isValidElement(code)) {
      try {
        const codeString = extractTextFromNode(code.props.children);
        void navigator.clipboard.writeText(codeString);
        setIsCopied(true);
        setTimeout(() => {
          setIsCopied(false);
        }, 2000);
      } catch (error) {
        console.warn("Copy to clipboard failed:", error);
      }
    }
  }, [code]);

  return (
    <div className="mb-4 flex flex-col ">
      <div className="flex w-full items-center justify-between rounded-t-lg bg-zinc-800 p-1 px-4 text-white">
        <div>{language.charAt(0).toUpperCase() + language.slice(1)}</div>
        <button
          onClick={handleCopyClick}
          className="flex items-center gap-2 rounded px-2 py-1 hover:bg-zinc-600 focus:outline-none"
        >
          <FaCopy />
          {isCopied ? "Copied!" : "Copy Code"}
        </button>
      </div>
      <pre className="rounded-t-[0]">{children}</pre>
    </div>
  );
};

interface CustomCodeBlockProps {
  inline?: boolean;
  className?: string;
  children: ReactNode;
}

const CustomCodeBlock = ({
  inline,
  className,
  children,
}: CustomCodeBlockProps) => {
  // Handle undefined or null children
  if (!children) {
    return null;
  }

  // Inline code blocks will be placed directly within a paragraph
  if (inline) {
    return (
      <code className="rounded bg-gray-200 px-1 py-[1px] text-black">
        {children}
      </code>
    );
  }

  const language = className ? className.replace("language-", "") : "plaintext";

  return <code className={`hljs ${language}`}>{children}</code>;
};

const CustomLink = ({ children, href }) => {
  // Handle undefined href
  if (!href) {
    return <span className="text-blue-400">{children}</span>;
  }

  return (
    <a
      className="link overflow-hidden"
      href={href as string}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
};

const isValidCustomCodeBlock = (
  element: ReactNode
): element is React.ReactElement<CustomCodeBlockProps> =>
  React.isValidElement(element) && element.type === CustomCodeBlock;

const extractLanguageName = (languageString: string): string => {
  if (!languageString || typeof languageString !== 'string') {
    return "";
  }

  // The provided language will be "language-{PROGRAMMING_LANGUAGE}"
  const parts = languageString.split("-");
  if (parts.length > 1) {
    return parts[1] || "";
  }
  return "";
};

const extractTextFromNode = (node: React.ReactNode): string => {
  if (typeof node === "string") {
    return node;
  }

  if (typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(extractTextFromNode).join("");
  }

  if (React.isValidElement(node)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument,@typescript-eslint/no-unsafe-member-access
      return extractTextFromNode(node.props.children);
    } catch (error) {
      console.warn("Error extracting text from node:", error);
      return "";
    }
  }

  return "";
};

export default MarkdownRenderer;