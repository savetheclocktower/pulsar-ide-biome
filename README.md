# pulsar-ide-biome

A package for linting and code formtting via [Biome](https://biomejs.dev/) — a replacement for both ESLint and Prettier that formats and lints JavaScript, TypeScript, JSON, and CSS.

## Getting started

You should [install and setup Biome](https://biomejs.dev/guides/getting-started/) in your project.

This package will expect a `biome.json` or `biome.jsonc` file at your project root. Neither linting nor formatting will function if they are not enabled in [your configuration file](https://biomejs.dev/reference/configuration/).

## Package prerequisites

Each of these is optional; you can decline to install the associated package if you don’t care about the feature.

* For automatically formatting your JavaScript and TypeScript files on save: there are no prerequisites.
* For linting your source code: [linter](https://web.pulsar-edit.dev/packages/linter) and [linter-ui-default](https://web.pulsar-edit.dev/packages/linter-ui-default).
* For on-demand formatting of a selected region of your code: [a package that consumes the `code-format.range` service](https://web.pulsar-edit.dev/packages?serviceType=consumed&service=code-format.range).

### Why is this an “IDE” package?

Because Biome [implements a language server](https://biomejs.dev/guides/integrate-in-editor/) for its editor integration.

### Why isn’t my code formatting package in charge of formatting on save?

Because `atom-ide-code-format` is a heavy dependency for what will be a commonly requested feature.

There are other reasons, too. The automatic reformat on save happens more gracefully when we control it, and it lets the user enable or disable the associated setting without requiring a restart of Pulsar.
