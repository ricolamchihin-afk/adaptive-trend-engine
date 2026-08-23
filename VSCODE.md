# Open this project in VS Code

You asked to leave PyCharm. Use Visual Studio Code as the editor. The Git
repo stays the same. This is the folder of files plus the diary of every
saved change.

## PowerShell rules (read this first)

Run one command at a time. Press Enter after each line. Wait for it to
finish before you type the next one.

Never paste these:

- `copilot-debug`
- any text that contains `<` or `>`
- the words `your command here`

PowerShell treats `<` as a special character. That is why this failed:

```
copilot-debug <your command here>
The '<' operator is reserved for future use.
```

If you already cloned into `C:\\Users\\user\\Cursor`, do not clone again.

There may also be an empty folder at
`C:\\Users\\user\\PycharmProjects\\Cursor`. That is a different box. npm must
run in the folder that contains `package.json`. Check first:

```powershell
dir C:\\Users\\user\\Cursor\\package.json
```

If that file is listed, use `C:\\Users\\user\\Cursor`. If npm says ENOENT
and the path is `PycharmProjects\\Cursor`, you are in the wrong folder.

## What a repo is, in kid words

A repo is a Lego box with a diary.

- The box holds the pieces: the code files.
- The diary is Git: each page says what changed and when.
- GitHub (or Cursor origin) is a copy of that box in the cloud, so you can
  open the same box on a new computer.

PyCharm and VS Code are two different desks. The Lego box does not change
when you switch desks.

## 1. Install the tools

1. Install [VS Code](https://code.visualstudio.com/). During setup, tick
   Add to PATH. If you already installed it, you can still open it from
   the Start menu without PATH.
2. Install [Git](https://git-scm.com/). During setup, leave Git from the
   command line checked.
3. Install [Node.js 20+](https://nodejs.org/). Choose the LTS build. This
   project uses npm.

You do not need the Python plugin for this app. The paper console is
Node.js / TypeScript.

## 2. Clone (only if the folder is missing)

In PowerShell, type this line, then press Enter:

```powershell
cd C:\\Users\\user
```

Then this line, then press Enter:

```powershell
git clone https://github.com/ricolamchihin-afk/smart-grid-conservative-readiness.git Cursor
```

If GitHub asks you to sign in, finish that in the browser, then wait until
you see `Receiving objects: 100%`.

If you already see `Cloning into 'Cursor'...` and `done.`, skip this
section.

## 3. Open the folder (do this even if `code` failed)

The command `code` only works after VS Code is installed and added to PATH.
You do not need that command.

1. Open the Start menu.
2. Type Visual Studio Code and open it.
3. If Windows cannot find it, install it from https://code.visualstudio.com/
   then come back to this step.
4. In VS Code: File: Open Folder.
5. Go to `C:\\Users\\user\\Cursor`.
6. Click Select Folder.

This replaces PyCharm's Open Project. One folder is one workspace.

Optional later: add the `code` command so PowerShell can launch VS Code.

1. Open VS Code from the Start menu.
2. Press `Ctrl+Shift+P`.
3. Type `shell command`.
4. If you see Install code command in PATH, run it.
5. Close PowerShell and open a new one.

On some Windows installs that menu item is missing. That is fine. Keep
using File: Open Folder.

Recommended extensions when VS Code asks:

- ESLint
- TypeScript and JavaScript Language Features (built in)

Do not install a live-trading plugin. This repo has no write adapter.

## 4. Install and check

In VS Code: Terminal: New Terminal.

Then run these one at a time. The first line is required. npm looks for
`package.json` in the folder you are standing in.

```powershell
cd C:\\Users\\user\\Cursor
```

```powershell
dir package.json
```

You must see `package.json` listed. If you do not, stop and check the
path. Do not run npm from `C:\\Users\\user\\PycharmProjects\\Cursor` unless
that folder also shows `package.json`.

On many Windows machines PowerShell blocks `npm.ps1`. If you see
`running scripts is disabled`, use `npm.cmd` instead of `npm`:

```powershell
npm.cmd install
```

```powershell
npm.cmd test
```

```powershell
npm.cmd run dev
```

The console is at http://127.0.0.1:43871

Leave that terminal running while you use the console. Stop it with `Ctrl+C`.

If `npm` or `npm.cmd` is not recognized, install Node.js LTS, close every
terminal, and try again.

### Optional: let `npm` work in PowerShell

This changes the policy for your Windows user only, not the whole PC:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Type `Y` if it asks. Close the terminal and open a new one. After that,
`npm install` works without `.cmd`.

Another path: in the VS Code terminal dropdown, choose Command Prompt,
then use `npm install` as usual.

## 5. PyCharm habits: VS Code equivalents

| You did this in PyCharm | Do this in VS Code |
|---|---|
| Open Project | File: Open Folder |
| Run configuration | `npm run dev` in the terminal |
| Built-in terminal | Terminal: New Terminal |
| Commit / Push | Source Control sidebar, or `git` in the terminal |
| Find in files | `Ctrl+Shift+F` |
| Go to file | `Ctrl+P` |

## 6. Daily loop

1. `git pull` before you start.
2. Edit in VS Code.
3. `npm test` after engine changes.
4. `git add`, `git commit`, `git push` when you want the remote updated.

## What changed in the paper logic

- Venue: Phoenix only.
- Capital: 1000 USDC.
- Preferred bias: long-biased (BTC still treated as the bullish default).
- Available switches: Neutral and Short-biased. These are paper books. They
  do not enable live orders.
- `live_actions_enabled` stays false.
