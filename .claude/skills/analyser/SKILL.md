---
name: analyser
description: Analyse the code of the current repository in Cockpit: map its modules and business objects, extract the business rules of its features, and look for bugs, security flaws and architecture or stack opinions. Use when the user asks to analyse the repository, or sends a message like "/analyser carte", "/analyser regles Connexion, Facturation" or "/analyser bugs securite" or "/analyser versions".
---

# Analyse the repository

You analyse the code of the project in up to six parts, each backed by citations that Cockpit checks on GitHub: the **map** (its modules, their runtimes, and their objects with fields and links), the **rules** (the business rules of the features the user names) and the **findings**: **bugs**, **securite** (security flaws), **architecture** (architecture and stack opinions) and **versions** (version upgrades). You write nothing to the repository.

The argument says what to do: `/analyser carte` for the map, `/analyser regles <features>` for the rules of the features (for example `/analyser regles Connexion, Facturation`), `/analyser carte regles <features>` for both. The findings are `/analyser bugs`, `/analyser securite` and `/analyser architecture` and `/analyser versions`, alone or together with the others (for example `/analyser carte bugs securite architecture`). Without an argument, ask which one. The rules need at least one feature: ask for it when it is missing.

The Cockpit tools are named `mcp__cockpit__<tool>`. If they are not available, the `cockpit` MCP server is not connected: tell the user and stop.

## Before you start

If a check fails, stop and say why. Change nothing.

1. **The folder.** The current folder must be the repository of the project: compare `git remote get-url origin` with the `full_name` of the project (step 2 of "Workflow").
2. **The working tree.** `git status --porcelain` must print nothing, and `HEAD` must be pushed (`git fetch origin`, then `git branch -r --contains HEAD` must list a branch): Cockpit reads the files on GitHub at the commit you cite.

## Workflow

1. **The project.** Call `mcp__cockpit__list_projects` and take the one whose `full_name` is this repository's. Refuse an archived project.
2. **Its rules.** Call `mcp__cockpit__get_project` with its `project_id`: the `claude_md` tells the vocabulary and what the code base does.
3. **The map** (only with `carte`). Launch the `cartographer` agent with the `project_id` and the rules. It reads the repository at the commit of `HEAD` and calls `mcp__cockpit__submit_code_map`. When Cockpit refuses a call, the refusal names the faulty location: the agent fixes it and sends the call again.
4. **The rules** (only with `regles`). With `regles` alone, tell the user that the objects of the rules are checked against the last map, and suggest `carte` too if the code changed since. For each feature asked, launch the `rules-analyst` agent with the `project_id`, the feature and the rules of the project. It reads the code of the feature at the commit of `HEAD`, writes at most 5 rules per user story (each with its summary and its given / when / then in French, its reasoning and, when it is unsure, its doubt), cites each rule, and calls `mcp__cockpit__create_takeover_stories`. When Cockpit refuses a call, the refusal names the faulty location: the agent fixes it and sends the call again. One feature after the other, never in parallel.
5. **The findings** (only with `bugs`, `securite`, `architecture` or `versions`). If the project has no map yet (no module in the « Conception » tab: ask the user, or run the `carte` part first), make the map first. Then, one part after the other, never in parallel, launch the agent of the part with the `project_id` and the rules of the project: `bugs` is the `bug-hunter` agent, `securite` the `security-reviewer` agent and `architecture` the `architect` agent and `versions` the `upgrade-advisor` agent. Each one calls `mcp__cockpit__list_findings` first so as not to file again what is known, reads the code at the commit of `HEAD`, cites each finding, and calls `mcp__cockpit__submit_findings`. When Cockpit refuses a call, the refusal names the faulty location: the agent fixes it and sends the call again.
6. **Report.** Tell the user which modules were mapped and how many objects each has, and which stories of rules were written for each feature and how many rules each has. The map and the rules are in the « Conception » tab of the project in Cockpit: the user judges each rule there, you decide none. The findings are in the « Constats » chip of the same tab: say how many each agent filed, by kind. The user triages them there, you decide none. If an agent stopped on a refusal, give it as it is.
