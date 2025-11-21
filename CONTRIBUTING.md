# Contributing to Invest-igator

First off, thank you for considering contributing to Invest-igator! It's people like you that make open source such a great community.

We welcome any type of contribution, not just code. You can help with:

* **Reporting a bug**
* **Discussing the current state of the code**
* **Submitting a fix**
* **Proposing new features**
* **Becoming a maintainer**

## Getting Started

To get started, you'll need to have [Bun](https://bun.sh/) installed, as it's the preferred runtime for this project.

1. **Fork and Clone the Repository**

    First, fork the repository to your own GitHub account. Then, clone it to your local machine:

    ```bash
    git clone https://github.com/YOUR_USERNAME/invest-igator.git
    cd invest-igator
    ```

2. **Install Dependencies**

    Install the project dependencies using Bun:

    ```bash
    bun install
    ```

3. **Set Up Environment Variables**

    Copy the `.env.example` file to a new file named `.env` and fill in the required environment variables.

    ```bash
    cp .env.example .env
    ```

    You will need to provide credentials for your database, authentication provider, and any other services the application uses.

4. **Set Up the Database**

    The project uses PostgreSQL with Prisma. A Docker Compose setup is provided for convenience.

    Start the database container:

    ```bash
    ./start-database.sh
    ```

    Once the database is running, apply the database schema:

    ```bash
    bun run db:push
    ```

    Or to run migrations:

    ```bash
    bun run db:migrate
    ```

5. **Run the Development Server**

    Start the Next.js development server:

    ```bash
    bun run dev
    ```

    The application should now be running at `http://localhost:3000`.

## How to Contribute

### Reporting Bugs or Suggesting Features

If you find a bug or have an idea for a new feature, please open an issue on GitHub. Provide as much detail as possible, including steps to reproduce the bug or a clear description of the proposed feature.

### Submitting Changes

1. **Create a Branch**

    Create a new branch for your changes. Use a descriptive name, like `fix/login-bug` or `feat/add-dark-mode`.

    ```bash
    git checkout -b your-branch-name
    ```

2. **Make Your Changes**

    Make your code changes, and please follow the coding style guidelines below.

3. **Check Code Style and Types**

    Before committing, ensure your code adheres to the project's style guidelines by running the linter and type checker.

    ```bash
    bun run check
    bun run typecheck
    ```

4. **Run Tests**

    Make sure all tests pass before submitting your changes.

    ```bash
    bun run test:e2e
    ```

5. **Commit Your Changes**

    Commit your changes with a clear and descriptive commit message.

    ```bash
    git commit -m "feat: Add dark mode toggle"
    ```

6. **Push to Your Fork**

    Push your changes to your forked repository.

    ```bash
    git push origin your-branch-name
    ```

7. **Create a Pull Request**

    Open a pull request from your fork to the `main` branch of the original repository. Provide a clear description of the changes you've made.

## Code Style

This project uses [Biome](https://biomejs.dev/) for code formatting and linting. Please run `bun run check` to format and lint your code before committing.

## Code of Conduct

This project and everyone participating in it is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior.

Thank you for your contribution!
