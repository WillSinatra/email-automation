import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DashboardPage from "../src/pages/DashboardPage";
import FilterBar from "../src/components/FilterBar";
import * as api from "../src/services/api";

jest.mock("../src/services/api");

describe("Filter behavior via DashboardPage", () => {
  const baseEmails = [
    {
      id: 1,
      sender: "a@gmail.com",
      raw_sender: "Alice <a@gmail.com>",
      domain: "gmail.com",
      subject: "Trusted one",
      date: "2026-01-01T10:00:00.000Z",
      classification: "trusted",
    },
    {
      id: 2,
      sender: "b@bad.test",
      raw_sender: "Bob <b@bad.test>",
      domain: "bad.test",
      subject: "Spam one",
      date: "2026-01-02T10:00:00.000Z",
      classification: "spam",
    },
  ];

  beforeEach(() => {
    api.getEmails.mockResolvedValue(baseEmails);
    api.fetchEmails.mockResolvedValue([]);
    api.clearEmails.mockResolvedValue({ success: true });
  });

  test("filtering by spam hides trusted emails", async () => {
    render(
      <DashboardPage
        credentials={{ host: "imap.test.com", port: 993, user: "u@test.com", password: "x" }}
        onDisconnect={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Trusted one")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Spam"));

    expect(screen.queryByText("Trusted one")).not.toBeInTheDocument();
    expect(screen.getByText("Spam one")).toBeInTheDocument();
  });

  test("domain text filter is case-insensitive", async () => {
    render(
      <DashboardPage
        credentials={{ host: "imap.test.com", port: 993, user: "u@test.com", password: "x" }}
        onDisconnect={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Trusted one")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Filter by domain..."), {
      target: { value: "GMAIL.COM" },
    });

    expect(screen.getByText("Trusted one")).toBeInTheDocument();
    expect(screen.queryByText("Spam one")).not.toBeInTheDocument();
  });
});

describe("FilterBar", () => {
  test("renders classification filters in the requested order", () => {
    render(
      <FilterBar
        filterClass="all"
        filterDomain=""
        filterMonth=""
        filterYear="2026"
        onClassChange={jest.fn()}
        onDomainChange={jest.fn()}
        onMonthChange={jest.fn()}
        onYearChange={jest.fn()}
        onClear={jest.fn()}
        clearLoading={false}
        clearError={null}
      />
    );

    const labels = screen.getAllByRole("radio").map((radio) => radio.closest("label").textContent);
    expect(labels).toEqual([
      "All",
      "Trusted",
      "Spam",
      "Read",
      "Ignored",
      "Ventas",
      "Administracion",
      "Soporte Tecnico",
    ]);
  });
});
