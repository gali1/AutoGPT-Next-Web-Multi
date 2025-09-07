// src/utils/helpers.ts

type Constructor<T> = new (...args: unknown[]) => T;

/* Check whether array is of the specified type */
export const isArrayOfType = <T>(
  arr: unknown[] | unknown,
  type: Constructor<T> | string
): arr is T[] => {
  return (
    Array.isArray(arr) &&
    arr.every((item): item is T => {
      if (typeof type === "string") {
        return typeof item === type;
      } else {
        return item instanceof type;
      }
    })
  );
};

export const removeTaskPrefix = (input: string): string => {
  // Regular expression to match task prefixes. Consult tests to understand regex
  const prefixPattern =
    /^(Task\s*\d*\.\s*|Task\s*\d*[-:]?\s*|-?\d+\s*[-:]?\s*)/i;

  // Replace the matched prefix with an empty string
  return input.replace(prefixPattern, "");
};

export const extractTasks = (
  text: string,
  completedTasks: string[]
): string[] => {
  try {
    // Handle empty or invalid input
    if (!text || typeof text !== 'string') {
      console.warn("Empty or invalid text provided to extractTasks");
      return [];
    }

    const cleanedText = text.trim();
    if (cleanedText.length === 0) {
      console.warn("Empty text after trimming");
      return [];
    }

    // Handle special case where LLM returns just "[]"
    if (cleanedText === '[]') {
      console.log("LLM returned empty array explicitly");
      return [];
    }

    return extractArray(cleanedText)
      .filter(realTasksFilter)
      .filter((task) => !(completedTasks || []).includes(task))
      .map(removeTaskPrefix);
  } catch (error) {
    console.error("Error extracting tasks:", error);
    console.log("Raw text that failed to parse:", text);

    // Fallback: try to extract individual tasks from the text
    return extractTasksFromPlainText(text)
      .filter(realTasksFilter)
      .filter((task) => !(completedTasks || []).includes(task))
      .map(removeTaskPrefix);
  }
};

// Enhanced array extraction with multiple strategies and better error handling
export const extractArray = (inputStr: string): string[] => {
  // Handle empty input
  if (!inputStr || typeof inputStr !== 'string') {
    console.warn("Empty or invalid input to extractArray");
    return [];
  }

  // Clean the input string
  const cleanedStr = inputStr.trim();

  // Handle explicit empty array
  if (cleanedStr === '[]') {
    console.log("Found explicit empty array");
    return [];
  }

  // Strategy 1: Look for JSON array pattern (most specific first)
  const strategies = [
    // Complete JSON array with quotes
    /\[(?:\s*"[^"]*"\s*(?:,\s*"[^"]*"\s*)*)\]/g,
    // JSON array with single quotes
    /\[(?:\s*'[^']*'\s*(?:,\s*'[^']*'\s*)*)\]/g,
    // More permissive JSON array pattern
    /\[(?:\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*(?:,\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*)*)\]/g,
    // Very permissive array pattern (includes nested structures)
    /(\[(?:\s*(?:"(?:[^"\\]|\\.|\n)*"|'(?:[^'\\]|\\.|\n)*')\s*,?)+\s*\])/g
  ];

  for (const strategy of strategies) {
    try {
      const matches = Array.from(cleanedStr.matchAll(strategy));

      for (const match of matches) {
        if (match[0]) {
          try {
            const parsed = JSON.parse(match[0]) as string[];
            if (Array.isArray(parsed)) {
              const validTasks = parsed.filter(item =>
                typeof item === 'string' &&
                item.trim().length > 0
              );

              if (validTasks.length > 0) {
                console.log("Successfully parsed array with strategy:", strategy.source);
                return validTasks;
              }
            }
          } catch (error) {
            // Try to fix common JSON issues
            const fixedJson = fixCommonJsonIssues(match[0]);
            try {
              const parsed = JSON.parse(fixedJson) as string[];
              if (Array.isArray(parsed)) {
                const validTasks = parsed.filter(item =>
                  typeof item === 'string' &&
                  item.trim().length > 0
                );

                if (validTasks.length > 0) {
                  console.log("Successfully parsed array after fixing JSON issues");
                  return validTasks;
                }
              }
            } catch (secondError) {
              console.warn("Failed to parse even after JSON fixes:", secondError);
            }
          }
        }
      }
    } catch (strategyError) {
      console.warn("Strategy failed:", strategyError);
      continue;
    }
  }

  console.warn("Could not extract JSON array, trying plain text extraction for:", cleanedStr);
  return extractTasksFromPlainText(cleanedStr);
};

// Fix common JSON formatting issues with better error handling
function fixCommonJsonIssues(jsonStr: string): string {
  try {
    let fixed = jsonStr.trim();

    // Remove any text before the first [
    const firstBracket = fixed.indexOf('[');
    if (firstBracket !== -1) {
      fixed = fixed.substring(firstBracket);
    }

    // Remove any text after the last ]
    const lastBracket = fixed.lastIndexOf(']');
    if (lastBracket !== -1) {
      fixed = fixed.substring(0, lastBracket + 1);
    }

    // Fix missing quotes around strings that don't have them
    fixed = fixed.replace(/\[\s*([^"'\[\]]+)\s*\]/g, '["$1"]');
    fixed = fixed.replace(/,\s*([^"'\[\],]+)\s*(?=,|\])/g, ', "$1"');
    fixed = fixed.replace(/\[\s*([^"'\[\],]+)\s*,/g, '["$1",');

    // Fix trailing commas
    fixed = fixed.replace(/,\s*\]/g, ']');
    fixed = fixed.replace(/,\s*,/g, ',');

    // Fix missing commas between strings
    fixed = fixed.replace(/"\s+"(?!")/g, '", "');

    // Fix single quotes to double quotes
    fixed = fixed.replace(/'/g, '"');

    // Fix escaped quotes that shouldn't be escaped
    fixed = fixed.replace(/\\"/g, '"');

    // Fix newlines within strings
    fixed = fixed.replace(/\n/g, ' ');

    return fixed;
  } catch (error) {
    console.warn("Error fixing JSON issues:", error);
    return jsonStr; // Return original if fixing fails
  }
}

// Fallback method to extract tasks from plain text
function extractTasksFromPlainText(text: string): string[] {
  try {
    if (!text || typeof text !== 'string') {
      return [];
    }

    const lines = text.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    const tasks: string[] = [];

    for (const line of lines) {
      // Skip obvious non-task lines
      if (
        line.includes('goal') ||
        line.includes('objective') ||
        line.includes('Note:') ||
        line.includes('Here') ||
        line.length < 10 ||
        line.toLowerCase().includes('array') ||
        line.toLowerCase().includes('format')
      ) {
        continue;
      }

      // Look for numbered lists, bullet points, or task-like patterns
      const taskPatterns = [
        /^\d+\.\s*(.+)$/,           // 1. Task
        /^-\s*(.+)$/,               // - Task
        /^\*\s*(.+)$/,              // * Task
        /^Task\s*\d*:?\s*(.+)$/i,   // Task 1: ...
        /^Step\s*\d*:?\s*(.+)$/i,   // Step 1: ...
        /^Action\s*\d*:?\s*(.+)$/i, // Action 1: ...
      ];

      let taskFound = false;
      for (const pattern of taskPatterns) {
        const match = line.match(pattern);
        if (match && match[1]) {
          const taskText = match[1].trim();
          if (taskText.length > 5 && taskText.length < 200) {
            tasks.push(taskText);
            taskFound = true;
            break;
          }
        }
      }

      // If no pattern matches but line looks like a task, include it
      if (!taskFound && line.length > 15 && line.length < 200) {
        // Check if it looks like a sentence (has some structure)
        if (line.includes(' ') && !line.includes('[') && !line.includes('{')) {
          tasks.push(line);
        }
      }
    }

    // If we still have no tasks, split by common delimiters
    if (tasks.length === 0) {
      const delimiters = ['. ', ', ', '; ', ' and ', ' then '];
      for (const delimiter of delimiters) {
        if (text.includes(delimiter)) {
          const splitTasks = text.split(delimiter)
            .map(t => t.trim())
            .filter(t => t.length > 10 && t.length < 200 && !t.includes('[') && !t.includes('{'));

          if (splitTasks.length > 0) {
            tasks.push(...splitTasks);
            break;
          }
        }
      }
    }

    return tasks.slice(0, 5); // Limit to 5 tasks max
  } catch (error) {
    console.error("Error in extractTasksFromPlainText:", error);
    return [];
  }
}

// Model will return tasks such as "No tasks added". We should filter these
export const realTasksFilter = (input: string): boolean => {
  try {
    if (!input || typeof input !== 'string') {
      return false;
    }

    const cleanInput = input.trim().toLowerCase();

    // Filter out empty or very short tasks
    if (cleanInput.length < 5) {
      return false;
    }

    // Filter out very long inputs that are likely not tasks
    if (cleanInput.length > 300) {
      return false;
    }

    const noTaskPatterns = [
      /^no( (new|further|additional|extra|other))? tasks? (is )?(required|needed|added|created|inputted)/i,
      /^task (complete|completed|finished|done|over|success)/i,
      /^(\s*|do nothing(\s.*)?)$/i,
      /^(none|n\/a|not applicable|skip|pass)$/i,
      /^(goal|objective|target|aim):/i,
      /^(note|info|information):/i,
      /^(here|this|these) (is|are)/i,
      /^(the goal|the objective)/i,
      /^(empty|null|undefined)$/i,
      /^(no tasks?|nothing|no action)$/i,
      /^task creation (complete|completed|finished)/i,
      /^goal (achieved|reached|completed)/i,
      /^\[?\]?$/i, // Empty array representations
    ];

    const isInvalidTask = noTaskPatterns.some(pattern => pattern.test(cleanInput));

    if (isInvalidTask) {
      return false;
    }

    // Additional checks for valid task structure
    // Tasks should typically be actionable (contain verbs)
    const actionWords = [
      'analyze', 'create', 'develop', 'build', 'implement', 'design', 'research',
      'study', 'learn', 'understand', 'investigate', 'explore', 'examine',
      'review', 'evaluate', 'assess', 'plan', 'organize', 'prepare', 'setup',
      'configure', 'install', 'deploy', 'test', 'validate', 'verify', 'check',
      'identify', 'find', 'search', 'gather', 'collect', 'compile', 'generate',
      'write', 'document', 'record', 'track', 'monitor', 'optimize', 'improve',
      'update', 'modify', 'enhance', 'fix', 'solve', 'resolve', 'address'
    ];

    const hasActionWord = actionWords.some(word => cleanInput.includes(word));

    // If it doesn't have an action word but has other indicators of being a task, still include it
    const taskIndicators = [
      cleanInput.includes('for '), // "Plan for the project"
      cleanInput.includes('to '),   // "Items to complete"
      cleanInput.includes('of '),   // "Analysis of data"
      cleanInput.includes('with '), // "Working with team"
      cleanInput.includes('about '), // "Learning about topic"
    ];

    const hasTaskIndicator = taskIndicators.some(indicator => indicator);

    return hasActionWord || hasTaskIndicator;
  } catch (error) {
    console.warn("Error in realTasksFilter:", error);
    return false; // Err on the side of caution
  }
};