import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	Command,
} from "obsidian";

// Remember to rename these classes and interfaces!

interface LLMContextSettings {
	instructionTemplates: { [key: string]: string };
	outputOption: "clipboard" | "file" | "modal";
	outputFileName: string;
}

const SYSTEM_INSTRUCTION = `You are analyzing content from an Obsidian vault. 
You must refrain from inventing details.  

The data is structured with specific format markers:

===== [INSTRUCTION START] =====
This optional section contains specific instructions for you about what to do with the content.
If present, follow these instructions carefully.
===== [INSTRUCTION END] =====

===== [Main Content Start] =====
This section contains the primary document you should focus on.
Treat the document as the principal source of truth. Base all primary summaries, analyses, and outputs on this file first.

File Name: {filename}
===== [File Start] =====
{content of the main file}
===== [File End] =====
===== [Main Content End] =====

===== [Linked Files Start] =====
This section contains supporting documents that are referenced from the main content using [[filename]] syntax in Obsidian.
Whenever you encounter a reference in the main content in the format [[filename]], consult the corresponding file in the **Linked Files** section.  
Extract any relevant information from that file and integrate it into your overall analysis or response—even if its update status is uncertain.

Each file is structured as:

File Name: {filename}
===== [File Start] =====
{content of the linked file}
===== [File End] =====
===== [Linked Files End] =====`;

const DEFAULT_SETTINGS: LLMContextSettings = {
	instructionTemplates: {
		summarize:
			"Please summarize the main points from this Markdown content and its linked references.",
		review: "Please review the following Markdown content and its linked references.",
	},
	outputOption: "clipboard",
	outputFileName: "LLMPrompt.md",
};

export default class LLMContextPlugin extends Plugin {
	settings: LLMContextSettings;
	commands: Command[] = [];

	async onload() {
		await this.loadSettings();

		// Register commands for each instruction template
		this.registerCommands();

		// Add command to generate with custom instruction
		this.addCommand({
			id: "generate-llm-context-custom",
			name: "Generate LLM Context (Custom Instruction)",
			callback: async () => {
				const modal = new CustomInstructionModal(
					this.app,
					async (instruction) => {
						if (instruction) {
							await this.generateLLMPrompt("custom", instruction);
						}
					}
				);
				modal.open();
			},
		});

		// Add settings tab
		this.addSettingTab(new LLMContextSettingTab(this.app, this));
	}

	onunload() {
		// Clean up resources
	}

	async generateLLMPrompt(templateKey: string, customInstruction?: string) {
		const activeFile = this.app.workspace.getActiveFile();

		if (!activeFile) {
			new Notice("No active file selected");
			return;
		}

		try {
			// Get instruction text
			let instructionText = "";
			if (templateKey === "custom" && customInstruction) {
				instructionText = customInstruction;
			} else {
				// Check if the requested template exists
				if (!this.settings.instructionTemplates[templateKey]) {
					new Notice(`Template "${templateKey}" not found`);
					return;
				}

				// Get the instruction text from the template
				instructionText =
					this.settings.instructionTemplates[templateKey];
			}

			// Get main file content
			const mainFileContent = await this.app.vault.read(activeFile);

			// Extract links from the main file
			const linkMatches = Array.from(
				mainFileContent.matchAll(/\[\[([^\|\]]+)(\|([^\]]+))?\]\]/g)
			);
			const linkedFileNames = linkMatches.map((match) => match[1].trim());

			// Get all Markdown files in the vault
			const markdownFiles = this.app.vault.getMarkdownFiles();

			// Build the prompt with system instruction first
			let prompt = `===== [SYSTEM START] =====\n${SYSTEM_INSTRUCTION}\n===== [SYSTEM END] =====\n\n`;

			// Add user instruction if provided
			if (instructionText.trim() !== "") {
				prompt += `===== [INSTRUCTION START] =====\n${instructionText}\n===== [INSTRUCTION END] =====\n\n`;
			}

			// Add main content section
			prompt += `===== [Main Content Start] =====\n`;
			prompt += `File Name: ${activeFile.basename}\n`;
			prompt += `===== [File Start] =====\n`;
			prompt += `${mainFileContent}\n`;
			prompt += `===== [File End] =====\n`;
			prompt += `===== [Main Content End] =====\n\n`;

			// Add linked files section
			prompt += `===== [Linked Files Start] =====\n`;

			// Find and add each linked file (filtering out self-references and duplicates)
			let foundLinkedFiles = false;
			const processedFiles = new Set<string>(); // Track files we've already processed

			// Add the active file to the processed set to avoid self-references
			processedFiles.add(activeFile.basename.toLowerCase());

			for (const linkedName of linkedFileNames) {
				const normalizedName = linkedName.toLowerCase();

				// Skip if we've already processed this file (duplicate links)
				if (processedFiles.has(normalizedName)) {
					continue;
				}

				// Find the file by basename
				const linkedFile = markdownFiles.find(
					(file) => file.basename.toLowerCase() === normalizedName
				);

				if (linkedFile) {
					// Mark this file as processed
					processedFiles.add(normalizedName);

					// Skip self-references to the active file
					if (
						linkedFile.basename.toLowerCase() ===
						activeFile.basename.toLowerCase()
					) {
						continue;
					}

					foundLinkedFiles = true;
					const linkedContent = await this.app.vault.read(linkedFile);

					prompt += `File Name: ${linkedFile.basename}\n`;
					prompt += `===== [File Start] =====\n`;
					prompt += `${linkedContent}\n`;
					prompt += `===== [File End] =====\n`;
				}
			}

			if (!foundLinkedFiles) {
				prompt += `No linked files found.\n`;
			}

			prompt += `===== [Linked Files End] =====\n`;

			// Output the prompt based on the selected output option
			await this.outputPrompt(prompt);
		} catch (error) {
			console.error("Error generating LLM prompt:", error);
			new Notice(`Error: ${error.message}`);
		}
	}

	async outputPrompt(promptContent: string) {
		switch (this.settings.outputOption) {
			case "clipboard":
				await navigator.clipboard.writeText(promptContent);
				new Notice("LLM Context prompt copied to clipboard");
				break;

			case "file":
				const fileName = this.settings.outputFileName || "LLMPrompt.md";
				await this.app.vault.create(fileName, promptContent);
				new Notice(`LLM Context prompt saved to ${fileName}`);
				break;

			case "modal":
				new PromptDisplayModal(this.app, promptContent).open();
				break;
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Re-register commands to ensure they're up to date with any template changes
		this.registerCommands();
	}

	// Register commands for all templates
	registerCommands() {
		// Clear existing commands
		this.commands = [];

		// Add a command for each template
		Object.keys(this.settings.instructionTemplates).forEach(
			(templateKey) => {
				this.addCommand({
					id: `generate-llm-context-${templateKey}`,
					name: `Generate LLM Context (${templateKey})`,
					callback: () => this.generateLLMPrompt(templateKey),
				});
			}
		);
	}
}

/**
 * Modal for entering a custom instruction
 */
class CustomInstructionModal extends Modal {
	private callback: (instruction: string) => void;
	private instructionText: string = "";

	constructor(app: App, callback: (instruction: string) => void) {
		super(app);
		this.callback = callback;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Enter Custom Instruction" });

		const textareaEl = contentEl.createEl("textarea", {
			placeholder: "Enter your custom instruction for the LLM...",
		});
		textareaEl.style.width = "100%";
		textareaEl.style.height = "200px";
		textareaEl.style.marginBottom = "20px";

		textareaEl.addEventListener("input", () => {
			this.instructionText = textareaEl.value;
		});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Cancel")
					.setCta()
					.onClick(() => {
						this.close();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText("Generate")
					.setCta()
					.onClick(() => {
						this.callback(this.instructionText);
						this.close();
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class PromptDisplayModal extends Modal {
	private promptContent: string;

	constructor(app: App, promptContent: string) {
		super(app);
		this.promptContent = promptContent;
	}

	onOpen() {
		// Make the modal wider
		const modalEl = this.contentEl.parentElement as HTMLElement;
		if (modalEl) {
			modalEl.style.width = "80vw";
			modalEl.style.maxWidth = "1000px"; // Set a max-width to avoid too wide modals on large screens
		}

		const { contentEl } = this;

		contentEl.createEl("h2", { text: "Generated LLM Prompt" });

		// Parse prompt sections
		const promptSections = this.parsePromptSections(this.promptContent);

		// Create tabs container
		const tabsContainer = contentEl.createDiv();
		tabsContainer.style.display = "flex";
		tabsContainer.style.flexWrap = "wrap";
		tabsContainer.style.borderBottom =
			"1px solid var(--background-modifier-border)";
		tabsContainer.style.marginBottom = "15px";
		tabsContainer.style.gap = "4px";

		// Create content container
		const contentContainer = contentEl.createDiv();
		contentContainer.style.maxHeight = "70vh";
		contentContainer.style.overflow = "auto";

		// Apply tab styles function
		const applyTabStyle = (tab: HTMLElement, isActive: boolean) => {
			tab.style.backgroundColor = isActive
				? "var(--background-primary)"
				: "var(--background-secondary)";
			tab.style.color = isActive
				? "var(--text-accent)"
				: "var(--text-muted)";
			tab.style.fontWeight = isActive ? "bold" : "normal";
			tab.style.zIndex = isActive ? "2" : "1";
			tab.style.borderBottom = isActive
				? "1px solid var(--background-primary)"
				: "none";
		};

		// First create the "All Content" tab and section
		const allTab = tabsContainer.createDiv();
		allTab.textContent = "All Content";
		allTab.style.padding = "8px 12px";
		allTab.style.cursor = "pointer";
		allTab.style.borderRadius = "4px 4px 0 0";
		allTab.style.border = "1px solid var(--background-modifier-border)";
		allTab.style.borderBottom = "none";
		allTab.style.marginBottom = "-1px";

		// Create the All Content div and pre
		const allContent = contentContainer.createDiv();
		const allPre = allContent.createEl("pre");
		allPre.style.whiteSpace = "pre-wrap";
		allPre.style.padding = "1rem";
		allPre.style.margin = "0";
		allPre.style.border = "1px solid var(--background-modifier-border)";
		allPre.style.borderRadius = "4px";
		allPre.style.backgroundColor = "var(--code-background)";
		allPre.style.fontSize = "0.95em"; // Slightly smaller font for code
		allPre.style.lineHeight = "1.5"; // Better line height for readability

		// Highlight sections in the All Content view
		const highlightedContent = this.promptContent
			.replace(
				/(===== \[\w+( \w+)* (?:Start|END)\] =====)/gi,
				'<span style="color:var(--text-accent);font-weight:bold;">$1</span>'
			)
			.replace(
				/(File Name: [^\n]+)/g,
				'<span style="color:var(--text-success);font-weight:bold;">$1</span>'
			);
		allPre.innerHTML = this.cleanupNestedMarkers(highlightedContent);

		// Variables to track active tab/content
		let activeTab = allTab;
		let activeContent = allContent;

		// Start by making All Content active
		applyTabStyle(allTab, true);
		allContent.style.display = "block";

		// Define the section order and their display names
		const sectionOrder = [
			{ key: "instruction", displayName: "Instruction" },
			{ key: "mainContent", displayName: "Main Content" },
			{ key: "linkedFiles", displayName: "Linked Files" },
		];

		// Create tabs for each section in the defined order
		sectionOrder.forEach(({ key, displayName }) => {
			const content = promptSections[key];
			if (!content) return; // Skip if section doesn't exist

			// Create tab
			const tab = tabsContainer.createDiv();
			tab.textContent = displayName;
			tab.style.padding = "8px 12px";
			tab.style.cursor = "pointer";
			tab.style.borderRadius = "4px 4px 0 0";
			tab.style.border = "1px solid var(--background-modifier-border)";
			tab.style.borderBottom = "none";
			tab.style.marginBottom = "-1px";

			// Apply initial inactive style
			applyTabStyle(tab, false);

			// Create content
			const contentDiv = contentContainer.createDiv();
			contentDiv.style.display = "none"; // All sections hidden initially except All Content

			const pre = contentDiv.createEl("pre");
			pre.style.whiteSpace = "pre-wrap";
			pre.style.padding = "1rem";
			pre.style.margin = "0";
			pre.style.border = "1px solid var(--background-modifier-border)";
			pre.style.borderRadius = "4px";
			pre.style.backgroundColor = "var(--code-background)";
			pre.style.fontSize = "0.95em"; // Slightly smaller font for code
			pre.style.lineHeight = "1.5"; // Better line height for readability

			// Format the content for better display
			let formattedContent = content;

			// If it's main content or linked files, highlight file names
			if (key === "mainContent" || key === "linkedFiles") {
				formattedContent = content
					.replace(
						/(File Name: [^\n]+)/g,
						'<span style="color:var(--text-success);font-weight:bold;">$1</span>'
					)
					.replace(
						/(===== \[File (?:Start|End)\] =====)/g,
						'<span style="color:var(--text-accent);">$1</span>'
					);
			}

			pre.innerHTML = this.cleanupNestedMarkers(formattedContent);

			// Tab click event
			tab.addEventListener("click", () => {
				applyTabStyle(activeTab, false);
				activeContent.style.display = "none";

				applyTabStyle(tab, true);
				contentDiv.style.display = "block";

				activeTab = tab;
				activeContent = contentDiv;
			});
		});

		// Add click handler for the All Content tab
		allTab.addEventListener("click", () => {
			applyTabStyle(activeTab, false);
			activeContent.style.display = "none";

			applyTabStyle(allTab, true);
			allContent.style.display = "block";

			activeTab = allTab;
			activeContent = allContent;
		});

		const buttonContainer = contentEl.createEl("div");
		buttonContainer.style.marginTop = "1rem";
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "space-between";

		const copyButton = buttonContainer.createEl("button", {
			text: "Copy to Clipboard",
		});
		copyButton.style.padding = "8px 16px";
		copyButton.style.backgroundColor = "var(--interactive-accent)";
		copyButton.style.color = "var(--text-on-accent)";
		copyButton.style.border = "none";
		copyButton.style.borderRadius = "4px";
		copyButton.style.cursor = "pointer";

		copyButton.addEventListener("click", async () => {
			await navigator.clipboard.writeText(this.promptContent);
			new Notice("Prompt copied to clipboard");
		});

		const closeButton = buttonContainer.createEl("button", {
			text: "Close",
		});
		closeButton.style.padding = "8px 16px";
		closeButton.style.backgroundColor = "var(--background-modifier-border)";
		closeButton.style.color = "var(--text-normal)";
		closeButton.style.border = "none";
		closeButton.style.borderRadius = "4px";
		closeButton.style.cursor = "pointer";

		closeButton.addEventListener("click", () => {
			this.close();
		});
	}

	/**
	 * Parse the prompt content into sections
	 */
	private parsePromptSections(content: string): Record<string, string> {
		const sections: Record<string, string> = {};

		// First, remove the SYSTEM section entirely from the content
		let cleanedContent = content.replace(
			/===== \[SYSTEM START\] =====\n[\s\S]*?===== \[SYSTEM END\] =====\n\n?/i,
			""
		);

		// Extract INSTRUCTION section - if it exists
		const instructionMatch = cleanedContent.match(
			/===== \[INSTRUCTION START\] =====\n([\s\S]*?)===== \[INSTRUCTION END\] =====/i
		);
		if (instructionMatch) {
			sections.instruction = instructionMatch[1];
		}

		// Extract Main Content section - note the case sensitivity in the markers
		const mainContentMatch = cleanedContent.match(
			/===== \[Main Content Start\] =====\n([\s\S]*?)===== \[Main Content End\] =====/i
		);
		if (mainContentMatch) {
			sections.mainContent = mainContentMatch[1];
		}

		// Extract Linked Files section
		const linkedFilesMatch = cleanedContent.match(
			/===== \[Linked Files Start\] =====\n([\s\S]*?)===== \[Linked Files End\] =====/i
		);
		if (linkedFilesMatch) {
			sections.linkedFiles = linkedFilesMatch[1];
		}

		return sections;
	}

	/**
	 * Cleanup any section markers that might appear within extracted content
	 */
	private cleanupNestedMarkers(content: string): string {
		// This will prevent any nested markers from being styled again
		return content.replace(/===== \[.+?\] =====/g, (match) => {
			// Replace < with &lt; to avoid HTML interpretation
			return match.replace(/</g, "&lt;");
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class LLMContextSettingTab extends PluginSettingTab {
	plugin: LLMContextPlugin;

	constructor(app: App, plugin: LLMContextPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "LLM Context Settings" });

		// Introduction
		const introDiv = containerEl.createEl("div");
		introDiv.style.marginBottom = "20px";
		introDiv.createEl("p", {
			text: "This plugin generates structured prompts for AI tools based on the current file and its linked references in your vault.",
		});

		// Output Options
		new Setting(containerEl)
			.setName("Output")
			.setDesc("Choose how you want to output the prompt")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("clipboard", "Copy to Clipboard")
					.addOption("file", "Save to File")
					.addOption("modal", "Display in Modal")
					.setValue(this.plugin.settings.outputOption)
					.onChange(async (value: "clipboard" | "file" | "modal") => {
						this.plugin.settings.outputOption = value;
						await this.plugin.saveSettings();
						this.display(); // Refresh the display to show/hide file name setting
					});
			});

		// File Name Setting (only show if output option is "file")
		if (this.plugin.settings.outputOption === "file") {
			const fileNameSetting = new Setting(containerEl)
				.setName("Output File Name")
				.setDesc("Name of the file to save the prompt to");

			const fileNameInputEl = document.createElement("textarea");
			fileNameInputEl.value = this.plugin.settings.outputFileName;
			fileNameInputEl.rows = 1;
			fileNameInputEl.style.width = "100%";
			fileNameInputEl.addEventListener("blur", async () => {
				this.plugin.settings.outputFileName = fileNameInputEl.value;
				await this.plugin.saveSettings();
			});

			fileNameSetting.controlEl.appendChild(fileNameInputEl);
		}

		// Instruction Templates Section
		containerEl.createEl("h3", { text: "Instruction Templates" });
		containerEl.createEl("p", {
			text: "Templates appear as commands in the command palette. Use them to quickly generate context for specific AI tasks.",
		});

		// Add template button
		new Setting(containerEl)
			.setName("Add New Template")
			.setDesc("Create a new instruction template")
			.addButton((button) => {
				button.setButtonText("Add Template").onClick(async () => {
					const templateName = await new TemplateNameModal(
						this.app
					).open();

					if (templateName && templateName.trim() !== "") {
						// Check if template already exists
						if (
							this.plugin.settings.instructionTemplates[
								templateName
							]
						) {
							new Notice(
								`Template "${templateName}" already exists`
							);
							return;
						}

						// Add new template
						this.plugin.settings.instructionTemplates[
							templateName
						] = "";
						await this.plugin.saveSettings();
						this.display(); // Refresh display
					}
				});
			});

		// Display all existing templates
		for (const templateName in this.plugin.settings.instructionTemplates) {
			const templateSection = containerEl.createDiv();
			templateSection.classList.add("template-section");
			templateSection.style.marginBottom = "20px";
			templateSection.style.padding = "10px";
			templateSection.style.border =
				"1px solid var(--background-modifier-border)";
			templateSection.style.borderRadius = "5px";

			const templateHeader = templateSection.createEl("h4", {
				text: templateName,
			});

			// Delete button
			const deleteButton = templateHeader.createEl("button", {
				text: "Delete",
				cls: "mod-warning",
			});
			deleteButton.style.marginLeft = "10px";
			deleteButton.style.float = "right";

			deleteButton.addEventListener("click", async () => {
				// Confirm deletion
				const confirmed = await new ConfirmationModal(
					this.app,
					`Delete template "${templateName}"?`
				).open();

				if (confirmed) {
					// Delete the template
					delete this.plugin.settings.instructionTemplates[
						templateName
					];

					await this.plugin.saveSettings();
					this.display(); // Refresh display
				}
			});

			// Template content textarea
			const templateTextarea = templateSection.createEl("textarea");
			templateTextarea.value =
				this.plugin.settings.instructionTemplates[templateName];
			templateTextarea.placeholder = "Enter instructions for the LLM...";
			templateTextarea.style.width = "100%";
			templateTextarea.style.minHeight = "150px";
			templateTextarea.addEventListener("blur", async () => {
				this.plugin.settings.instructionTemplates[templateName] =
					templateTextarea.value;
				await this.plugin.saveSettings();
			});
		}

		// System Instruction Section (moved to bottom)
		containerEl.createEl("h3", { text: "System Instruction" });

		const systemDescDiv = containerEl.createEl("div");
		systemDescDiv.style.marginBottom = "15px";
		systemDescDiv.createEl("p", {
			text: "This is the system instruction that is included at the beginning of every prompt. It describes the data structure to the AI.",
		});

		const systemInstructionDiv = containerEl.createEl("div");
		systemInstructionDiv.classList.add("system-instruction-container");
		systemInstructionDiv.style.border =
			"1px solid var(--background-modifier-border)";
		systemInstructionDiv.style.borderRadius = "5px";
		systemInstructionDiv.style.padding = "10px";
		systemInstructionDiv.style.backgroundColor =
			"var(--background-secondary)";
		systemInstructionDiv.style.marginBottom = "20px";

		const systemInstructionPre = systemInstructionDiv.createEl("pre");
		systemInstructionPre.style.whiteSpace = "pre-wrap";
		systemInstructionPre.style.margin = "0";
		systemInstructionPre.style.color = "var(--text-normal)";
		systemInstructionPre.textContent = SYSTEM_INSTRUCTION;
	}
}

/**
 * Modal for confirming an action
 */
class ConfirmationModal extends Modal {
	private result: boolean = false;
	private message: string;

	constructor(app: App, message: string) {
		super(app);
		this.message = message;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Confirm" });
		contentEl.createEl("p", { text: this.message });

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Cancel")
					.setCta()
					.onClick(() => {
						this.result = false;
						this.close();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText("Confirm")
					.setWarning()
					.onClick(() => {
						this.result = true;
						this.close();
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	async open(): Promise<boolean> {
		super.open();
		return new Promise((resolve) => {
			this.onClose = () => {
				this.contentEl.empty();
				resolve(this.result);
			};
		});
	}
}

/**
 * Modal for entering a template name
 */
class TemplateNameModal extends Modal {
	private result: string = "";

	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Enter Template Name" });

		const inputEl = contentEl.createEl("input", {
			type: "text",
			placeholder: "Template name",
		});
		inputEl.style.width = "100%";
		inputEl.style.marginBottom = "20px";

		inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				this.result = inputEl.value;
				this.close();
			}
		});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Cancel")
					.setCta()
					.onClick(() => {
						this.result = "";
						this.close();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText("Add")
					.setCta()
					.onClick(() => {
						this.result = inputEl.value;
						this.close();
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	async open(): Promise<string> {
		super.open();
		return new Promise((resolve) => {
			this.onClose = () => {
				this.contentEl.empty();
				resolve(this.result);
			};
		});
	}
}
