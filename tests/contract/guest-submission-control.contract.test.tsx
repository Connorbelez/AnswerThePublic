// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GuestSubmissionControl } from "@/components/guest-submission-control"

afterEach(cleanup)

describe("GuestSubmissionControl", () => {
  it("requires an accessible explicit confirmation that explains the immutable snapshot", async () => {
    const submit = vi.fn().mockResolvedValue(undefined)
    render(
      <GuestSubmissionControl canSubmit onSubmit={submit} submitted={false} />
    )

    fireEvent.click(screen.getByRole("button", { name: "Submit response" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toBeTruthy()
    expect(
      screen.getByRole("heading", {
        name: "Are you sure you’re ready to submit?",
      })
    ).toBeTruthy()
    expect(screen.getByText(/read-only snapshot/i)).toBeTruthy()
    expect(screen.getByText(/administrator can reopen/i)).toBeTruthy()
    expect(submit).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole("button", { name: "Yes, submit response" })
    )
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("exposes a durable submitted confirmation and cannot reopen its dialog", () => {
    render(<GuestSubmissionControl canSubmit onSubmit={vi.fn()} submitted />)

    const submitted = screen.getByRole("button", {
      name: "Response submitted",
    })
    expect((submitted as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(submitted)
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("restores keyboard focus to the Submit action when confirmation is cancelled", async () => {
    render(
      <GuestSubmissionControl canSubmit onSubmit={vi.fn()} submitted={false} />
    )
    const trigger = screen.getByRole("button", { name: "Submit response" })
    trigger.focus()
    fireEvent.click(trigger)
    await screen.findByRole("alertdialog")

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }))

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it("requires an accessible answer-mode choice when both drafts contain material", async () => {
    const submit = vi.fn().mockResolvedValue(undefined)
    render(
      <GuestSubmissionControl
        answerModeSelection={{
          batchHasMaterial: true,
          oneByOneHasMaterial: true,
        }}
        canSubmit
        onSubmit={submit}
        submitted={false}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Submit response" }))
    expect(
      screen.getByRole("radiogroup", {
        name: "Choose which response to submit",
      })
    ).toBeTruthy()
    const confirm = screen.getByRole("button", {
      name: "Yes, submit response",
    })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    expect(submit).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole("radio", {
        name: /^Answer one question at a time/,
      })
    )
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(confirm)

    await waitFor(() => expect(submit).toHaveBeenCalledWith("one_by_one"))
  })
})
