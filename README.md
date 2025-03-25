# Obsidian LLM Context Plugin

An Obsidian plugin that generates structured prompts for Large Language Models (LLMs) that include the content of the current file and any linked files.

## Features

- Generates a structured prompt with clear delimiters for LLM parsing
- Includes the content of the current file and all linked files (using Obsidian's `[[filename]]` link format)
- Intelligently handles self-references and duplicate links:
  - Ignores links that reference the current file itself
  - Only includes each linked file once, even if referenced multiple times
- Clear SYSTEM instruction followed by optional USER instruction
- Multiple instruction templates for different use cases
- Ability to create and save custom instruction templates
- Multiple output options:
  - Copy to clipboard
  - Save to a file
  - Display in a modal with tabbed sections for better organization

## Usage

1. Open a Markdown file in Obsidian
2. Trigger the plugin using one of the following methods:
   - Use the command palette and select one of the "LLM Context" commands
   - Use a hotkey (if configured)
3. The plugin will generate a prompt that includes:
   - A SYSTEM section explaining the data structure
   - Your selected instruction (if any)
   - The content of the current file
   - The content of any files linked with `[[filename]]` syntax

## Settings

### Output Options

- **Copy to Clipboard**: Copies the generated prompt to your clipboard
- **Save to File**: Saves the prompt as a new Markdown file in your vault (customizable filename)
- **Display in Modal**: Shows the prompt in a modal window with:
  - Tabbed sections for better organization
  - Syntax highlighting for file names and markers
  - Copy button for easy copying

### Instruction Templates

The plugin comes with two default instruction templates:

- **summarize**: "Please summarize the main points from this Markdown content and its linked references."
- **review**: "Please review the following Markdown content and its linked references."

You can add, edit, or delete templates in the settings. Each template creates a corresponding command in the command palette.

## Custom Instructions

You can also create one-time custom instructions:

1. Use the "Generate LLM Context (Custom Instruction)" command
2. Enter your custom instruction text in the modal
3. Click "Generate"

Your custom instruction will be inserted into the INSTRUCTION section of the prompt.

## Installation

### From GitHub Release

1. Go to the [latest release](https://github.com/LHerskind/obsidian-llm-context/releases)
2. Download the `release.zip` file
3. Extract the ZIP file into your Obsidian vault's `.obsidian/plugins/obsidian-llm-context/` directory
4. Restart Obsidian
5. Enable the plugin in Settings > Community plugins

### For Developers

If you want to contribute or modify the plugin:

1. Clone this repository into your Obsidian vault's `.obsidian/plugins/obsidian-llm-context/` directory
2. Run `npm install`
3. Run `npm run dev` to start the development server
4. Make changes to the code

For the best development experience, we recommend using the [Hot Reload plugin](https://github.com/pjeby/hot-reload). With it installed:
1. The plugin will automatically reload when you make changes
2. You won't need to manually copy files or restart Obsidian

Alternatively, without Hot Reload:
1. Use `npm run build` to create a production build
2. Copy the following files to your Obsidian vault's `.obsidian/plugins/obsidian-llm-context/` directory:
   - `main.js`
   - `manifest.json`
   - `styles.css`
3. Restart Obsidian
4. Enable the plugin in Settings > Community plugins

## License

This project is licensed under the MIT License - see the LICENSE file for details.
