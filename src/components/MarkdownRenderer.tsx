// src/components/MarkdownRenderer.tsx

import React, { useCallback, useState } from "react";
import { FaCopy } from "react-icons/fa";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/default.css";

const MarkdownRenderer = ({ children }) => {
  // Handle undefined or null children with better error handling
  if (!children) {
    return <div className="text-gray-400 italic">No content to display</div>;
  }

  // Ensure children is a string and handle all types safely
  let cleanContent: string;
  try {
    if (typeof children === 'string') {
      cleanContent = children.trim();
    } else if (typeof children === 'number') {
      cleanContent = String(children);
    } else if (React.isValidElement(children)) {
      cleanContent = extractTextFromNode(children);
    } else {
      cleanContent = String(children).trim();
    }
  } catch (error) {
    console.warn('Error processing markdown content:', error);
    return <div className="text-yellow-400">Content could not be processed for display</div>;
  }

  if (cleanContent.length === 0) {
    return <div className="text-gray-400 italic">Empty content</div>;
  }

  // Pre-process content to avoid parsing issues
  const processedContent = preprocessMarkdownContent(cleanContent);

  return (
    <div className="markdown-container">
      <ReactMarkdown
        // remarkPlugins={[remarkGfm]} // Remove this line
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: CustomPre,
          code: CustomCodeBlock,
          a: (props) => CustomLink({ children: props.children, href: props.href }),
          p: (props) => <p className="mb-4">{props.children}</p>,
          ul: (props) => <ul className="ml-8 list-disc">{props.children}</ul>,
          ol: (props) => <ol className="ml-8 list-decimal">{props.children}</ol>,
          table: (props) => {
            try {
              return (
                <div className="overflow-x-auto">
                  <table className="w-full rounded-lg text-white bg-[#0d1117]">
                    {props.children}
                  </table>
                </div>
              );
            } catch (error) {
              console.warn("Table rendering error:", error);
              return (
                <div className="text-yellow-400 border border-yellow-500/50 p-2 rounded">
                  Table content could not be rendered
                </div>
              );
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
              return (
                <th className="rounded-lg border border-gray-700 px-4 py-2 bg-[#161b22]">
                  {props.children}
                </th>
              );
            } catch (error) {
              console.warn("Table header rendering error:", error);
              return (
                <td className="rounded-lg border border-gray-700 px-4 py-2">
                  {String(props.children)}
                </td>
              );
            }
          },
          td: (props) => {
            try {
              return (
                <td className="rounded-lg border border-gray-700 px-4 py-2">
                  {props.children}
                </td>
              );
            } catch (error) {
              console.warn("Table cell rendering error:", error);
              return (
                <td className="rounded-lg border border-gray-700 px-4 py-2">
                  {String(props.children)}
                </td>
              );
            }
          },
          div: (props) => {
            try {
              return <div {...props}>{props.children}</div>;
            } catch (error) {
              console.warn("Div rendering error:", error);
              return <div className="text-red-400">Content rendering error</div>;
            }
          },
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
};

// Pre-process markdown content to avoid common parsing issues
function preprocessMarkdownContent(content: string): string {
  try {
    let processed = content;

    // Fix malformed tables - ensure proper table structure
    processed = processed.replace(/\|(?!\s*[-:]+\s*\|)/g, (match, offset, string) => {
      // Check if this pipe is part of a table header separator
      const lineStart = string.lastIndexOf('\n', offset) + 1;
      const lineEnd = string.indexOf('\n', offset);
      const currentLine = string.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);

      // If the line contains only pipes, dashes, colons, and spaces, it's likely a table separator
      if (/^[\s\|\-:]+$/.test(currentLine)) {
        return match;
      }

      // Otherwise, escape the pipe to prevent table parsing issues
      return '\\|';
    });

    // Fix incomplete code blocks
    const codeBlockMatches = processed.match(/```/g);
    if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
      processed += '\n```';
    }

    // Fix incomplete inline code
    const inlineCodeMatches = processed.match(/`/g);
    if (inlineCodeMatches && inlineCodeMatches.length % 2 !== 0) {
      processed += '`';
    }

    // Remove problematic zero-width characters
    processed = processed.replace(/[\u200B-\u200D\uFEFF]/g, '');

    // Fix line breaks in tables
    processed = processed.replace(/\|([^|\n]*)\n([^|\n]*)\|/g, '|$1 $2|');

    return processed;
  } catch (error) {
    console.warn('Error preprocessing markdown:', error);
    return content; // Return original content if preprocessing fails
  }
}

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

        if (codeString && codeString.trim()) {
          // Use modern clipboard API with fallback
          if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(codeString).then(() => {
              setIsCopied(true);
              setTimeout(() => setIsCopied(false), 2000);
            }).catch((error) => {
              console.warn('Clipboard API failed, using fallback:', error);
              fallbackCopyToClipboard(codeString);
            });
          } else {
            fallbackCopyToClipboard(codeString);
          }
        }
      } catch (error) {
        console.warn("Copy to clipboard failed:", error);
      }
    }
  }, [code]);

  const fallbackCopyToClipboard = (text: string) => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      document.execCommand('copy');
      document.body.removeChild(textArea);

      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.warn("Fallback copy failed:", error);
    }
  };

  return (
    <div className="mb-4 flex flex-col">
      <div className="flex w-full items-center justify-between rounded-t-lg bg-zinc-800 p-1 px-4 text-white">
        <div className="text-sm font-medium">
          {language ? language.charAt(0).toUpperCase() + language.slice(1) : 'Code'}
        </div>
        <button
          onClick={handleCopyClick}
          className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-zinc-600 focus:outline-none transition-colors"
          aria-label="Copy code to clipboard"
        >
          <FaCopy />
          {isCopied ? "Copied!" : "Copy Code"}
        </button>
      </div>
      <pre className="rounded-t-[0] overflow-x-auto">{children}</pre>
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
  // Handle undefined or null children safely
  if (!children) {
    return null;
  }

  // Inline code blocks will be placed directly within a paragraph
  if (inline) {
    try {
      return (
        <code className="rounded bg-gray-200 px-1 py-[1px] text-black">
          {children}
        </code>
      );
    } catch (error) {
      console.warn("Inline code rendering error:", error);
      return <span className="bg-gray-200 px-1 py-[1px] text-black">{String(children)}</span>;
    }
  }

  const language = className ? className.replace("language-", "") : "plaintext";

  try {
    return <code className={`hljs ${language}`}>{children}</code>;
  } catch (error) {
    console.warn("Code block rendering error:", error);
    return <code className="hljs">{String(children)}</code>;
  }
};

const CustomLink = ({ children, href }) => {
  // Handle undefined href safely
  if (!href) {
    return <span className="text-blue-400">{children}</span>;
  }

  try {
    // Basic URL validation
    const isValidUrl = typeof href === 'string' && (
      href.startsWith('http://') ||
      href.startsWith('https://') ||
      href.startsWith('mailto:') ||
      href.startsWith('#') ||
      href.startsWith('/')
    );

    if (!isValidUrl) {
      return <span className="text-blue-400">{children}</span>;
    }

    return (
      <a
        className="link overflow-hidden text-blue-400 hover:text-blue-300 underline"
        href={href as string}
        target={href.startsWith('http') ? "_blank" : undefined}
        rel={href.startsWith('http') ? "noopener noreferrer" : undefined}
      >
        {children}
      </a>
    );
  } catch (error) {
    console.warn("Link rendering error:", error);
    return <span className="text-blue-400">{children}</span>;
  }
};

const isValidCustomCodeBlock = (
  element: ReactNode
): element is React.ReactElement<CustomCodeBlockProps> => {
  try {
    return React.isValidElement(element) && element.type === CustomCodeBlock;
  } catch (error) {
    console.warn("Code block validation error:", error);
    return false;
  }
};

const extractLanguageName = (languageString: string): string => {
  if (!languageString || typeof languageString !== 'string') {
    return "";
  }

  try {
    // The provided language will be "language-{PROGRAMMING_LANGUAGE}"
    const parts = languageString.split("-");
    if (parts.length > 1) {
      return parts[1] || "";
    }
    return languageString || "";
  } catch (error) {
    console.warn("Language extraction error:", error);
    return "";
  }
};

const extractTextFromNode = (node: React.ReactNode): string => {
  try {
    if (typeof node === "string") {
      return node;
    }

    if (typeof node === "number") {
      return String(node);
    }

    if (node === null || node === undefined) {
      return "";
    }

    if (Array.isArray(node)) {
      return node.map(extractTextFromNode).join("");
    }

    if (React.isValidElement(node)) {
      try {
        // Handle different prop structures safely
        if (node.props && typeof node.props === 'object') {
          if ('children' in node.props) {
            return extractTextFromNode(node.props.children);
          }

          // Some elements might have text content in other props
          if ('value' in node.props && typeof node.props.value === 'string') {
            return node.props.value;
          }

          if ('content' in node.props && typeof node.props.content === 'string') {
            return node.props.content;
          }
        }

        return "";
      } catch (error) {
        console.warn("Error extracting text from React element:", error);
        return "";
      }
    }

    // For any other object type, try to convert to string safely
    if (typeof node === 'object' && node !== null) {
      if ('toString' in node && typeof node.toString === 'function') {
        return node.toString();
      }
    }

    return String(node);
  } catch (error) {
    console.warn("Error in extractTextFromNode:", error);
    return "";
  }
};

export default MarkdownRenderer;