import { render, screen } from "@testing-library/react";
import EmailTable from "../src/components/EmailTable";

describe("EmailTable", () => {
  test("renders correct number of rows given mock data", () => {
    const emails = [
      {
        id: 1,
        sender: "a@gmail.com",
        raw_sender: "Alice <a@gmail.com>",
        domain: "gmail.com",
        subject: "A",
        date: "2026-01-01T10:00:00.000Z",
        classification: "trusted",
        isRead: true,
      },
      {
        id: 2,
        sender: "b@test.com",
        raw_sender: "Bob <b@test.com>",
        domain: "test.com",
        subject: "B",
        date: "2026-01-02T10:00:00.000Z",
        classification: "spam",
      },
    ];

    render(<EmailTable emails={emails} loading={false} />);

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
  });

  test("shows empty message when list is empty", () => {
    render(<EmailTable emails={[]} loading={false} />);
    expect(
      screen.getByText("No emails match the current filter.")
    ).toBeInTheDocument();
  });

  test("StatusBadge renders correct class per classification", () => {
    const emails = [
      {
        id: 1,
        sender: "a@gmail.com",
        raw_sender: "Alice <a@gmail.com>",
        domain: "gmail.com",
        subject: null,
        date: "2026-01-01T10:00:00.000Z",
        classification: "trusted",
        isRead: true,
      },
      {
        id: 2,
        sender: "b@test.com",
        raw_sender: "Bob <b@test.com>",
        domain: "test.com",
        subject: "B",
        date: "2026-01-02T10:00:00.000Z",
        classification: "spam",
      },
      {
        id: 3,
        sender: "c@drop.com",
        raw_sender: "Carl <c@drop.com>",
        domain: "drop.com",
        subject: "C",
        date: "2026-01-03T10:00:00.000Z",
        classification: "ignored",
      },
    ];

    render(<EmailTable emails={emails} loading={false} />);

    expect(screen.getByText("trusted")).toHaveClass("badge-trusted");
    expect(screen.getByText("spam")).toHaveClass("badge-spam");
    expect(screen.getByText("ignored")).toHaveClass("badge-ignored");
    expect(screen.getByText("read")).toHaveClass("badge-read");
    expect(screen.getAllByText("unread")[0]).toHaveClass("badge-unread");

    expect(screen.getByText("-")).toBeInTheDocument();
  });
});
