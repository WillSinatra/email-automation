import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ConnectionPage from "../src/pages/ConnectionPage";
import { connectToServer } from "../src/services/api";

jest.mock("../src/services/api", () => ({
  connectToServer: jest.fn(),
}));

describe("ConnectionPage", () => {
  test("renders all fields and connect button", () => {
    render(<ConnectionPage onConnect={jest.fn()} />);

    expect(screen.getByText("Host / server address")).toBeInTheDocument();
    expect(screen.getByText("Port")).toBeInTheDocument();
    expect(screen.getByText("Username / email")).toBeInTheDocument();
    expect(screen.getByText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  test("shows error message when fields are empty and connect is clicked", async () => {
    render(<ConnectionPage onConnect={jest.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(screen.getByText("Please complete all fields.")).toBeInTheDocument();
  });

  test("disables connect button while loading", async () => {
    let resolveRequest;
    connectToServer.mockImplementation(
      () => new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    const { container } = render(<ConnectionPage onConnect={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("imap.gmail.com"), {
      target: { value: "imap.gmail.com" },
    });
    fireEvent.change(screen.getByDisplayValue("993"), {
      target: { value: "993" },
    });
    const usernameInput = container.querySelector('input[autocomplete="username"]');
    const passwordInput = container.querySelector('input[type="password"]');

    fireEvent.change(usernameInput, {
      target: { value: "user@test.com" },
    });
    fireEvent.change(passwordInput, {
      target: { value: "secret" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(screen.getByRole("button", { name: "Connecting…" })).toBeDisabled();

    resolveRequest({ success: true });
    await waitFor(() => {
      expect(connectToServer).toHaveBeenCalled();
    });
  });
});
