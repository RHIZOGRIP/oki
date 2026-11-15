# Changes

What changed in each release of Oki, for the people who use it.

## 0.2.1

- Oki is free software under the GNU AGPL, version 3 only. The offer of a separate commercial licence is withdrawn.
- The source of Oki and of its chat page is public: https://github.com/RHIZOGRIP/oki and https://github.com/RHIZOGRIP/spore-plugin-web.

## 0.2.0

The first release of Oki for everyone.

- Oki for Windows 10 and 11: download the installer and open it.
- Oki for Linux: one line in a terminal.
- Start free: Oki offers the AI models that do an agent's work well, from OpenRouter, ChatGPT and Google, and from more providers once you have your first model.
- Your spores keep their conversations, memory and files on your computer, each in its own folder.
- Back up everything to one file, and restore it into a new Oki.

## 0.1.8

A test release, made to try how Oki is built and published. Not for general use.

- On Windows, Oki in the Start menu opens Oki: it starts it if needed and opens its page. A click on the icon near the clock does the same.
- Oki's logo on the Start menu entry, the installer, the icon near the clock and in Settings, Apps.
- The Start menu no longer shows a second entry, `Oki-<version>`.
- Oki asks mohdex for the models only while you use it, not every hour.

## 0.1.7

A test release, made to try how Oki is built and published. Not for general use.

- On Linux, Oki checks before it starts that you may use /dev/kvm, and says how to get that right.
- On a computer with no /dev/kvm, Oki says it would run very slowly and how to turn virtualisation on. `--no-kvm` installs it anyway.
- When Oki cannot start for another reason, it shows the error QEMU gave.

## 0.1.6

A test release, made to try how Oki is built and published. Not for general use.

- On Linux, Oki checks for virtiofsd before it starts anything, and says in one line what to install.
- A clearer message when Lima is installed but the shell does not find it.

## 0.1.5

A test release, made to try how Oki is built and published. Not for general use.

- On Linux, the message about a missing virtiofsd now shows every time, and also when an Oki that was already installed cannot start. An Oki that was already installed is never removed.

## 0.1.4

A test release, made to try how Oki is built and published. Not for general use.

- On Linux, when Oki cannot start because QEMU or virtiofsd is missing, it says which one, and how to install it on Debian or Ubuntu. A first start that fails leaves nothing behind, so starting again is enough.
- Larger text on Oki's own pages.
- Models from more providers: every provider with a model that meets spore's bar, or comes near it, is offered once you have a first model. Expert lists every text model mohdex knows.
- A link to Oki's Discord on every page, and a Questions section on the system page.

## 0.1.3

A test release, made to try how Oki is built and published. Not for general use.

- A package for Linux, beside the Windows installer.
- Release notes, taken from this file.
