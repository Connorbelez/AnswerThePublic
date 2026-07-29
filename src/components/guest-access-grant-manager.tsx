import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Copy, Link2, Plus, UserRound } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export type GuestAccessPerson = {
  personId: string
  displayName: string
  email: string
  isFounder: boolean
}

export type GuestAccessGrantListItem = {
  grantId: string
  person: GuestAccessPerson
  state: string
  expiresAt: number
  createdAt: number
  latestActivityAt?: number
  progress?: { completed: number; total: number }
  submitted?: boolean
  events?: Array<{
    kind: string
    occurredAt: number
    actor: "guest" | "administrator" | "system"
    actorName?: string
    tokenVersion: number | null
  }>
}

export type GuestAccessGrantCreation = {
  token: string | null
  expiresAt?: number
  grant?: { expiresAt: number }
}

type GuestAccessGrantManagerProps = {
  people: Array<GuestAccessPerson>
  defaultPersonId: string | null
  grants: Array<GuestAccessGrantListItem>
  disabled?: boolean
  onCreatePerson(input: {
    displayName: string
    email: string
  }): Promise<GuestAccessPerson>
  onSearchPeople(query: string): Promise<Array<GuestAccessPerson>>
  onGenerate(input: { personId: string }): Promise<GuestAccessGrantCreation>
  onRevoke?(grantId: string): Promise<void>
  onRenew?(grantId: string): Promise<GuestAccessGrantCreation>
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto",
  }).format(timestamp)
}

async function writeClipboard(value: string) {
  if (!navigator.clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE")
  await navigator.clipboard.writeText(value)
}

export function GuestAccessGrantManager({
  people,
  defaultPersonId,
  grants,
  disabled = false,
  onCreatePerson,
  onSearchPeople,
  onGenerate,
  onRevoke,
  onRenew,
}: GuestAccessGrantManagerProps) {
  const defaultPerson =
    people.find((person) => person.personId === defaultPersonId) ??
    people.find((person) => person.isFounder) ??
    people[0] ??
    null
  const [createdPeople, setCreatedPeople] = useState<Array<GuestAccessPerson>>(
    []
  )
  const [selectedPerson, setSelectedPerson] =
    useState<GuestAccessPerson | null>(defaultPerson)
  const [creatingPerson, setCreatingPerson] = useState(false)
  const [displayName, setDisplayName] = useState("")
  const [email, setEmail] = useState("")
  const [pending, setPending] = useState<"person" | "grant" | "copy" | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<Array<GuestAccessPerson>>(
    []
  )
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const searchSequence = useRef(0)
  const [copyStatus, setCopyStatus] = useState<"copied" | "manual" | "idle">(
    "idle"
  )
  const [lifecyclePending, setLifecyclePending] = useState<string | null>(null)
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(
    null
  )

  const options = useMemo(() => {
    const byId = new Map<string, GuestAccessPerson>()
    for (const person of [...people, ...createdPeople, ...searchResults]) {
      byId.set(person.personId, person)
    }
    return [...byId.values()]
  }, [createdPeople, people, searchResults])

  useEffect(() => {
    const query = searchQuery.trim()
    const sequence = ++searchSequence.current
    if (!query) return

    const timer = window.setTimeout(() => {
      void onSearchPeople(query)
        .then((matches) => {
          if (searchSequence.current !== sequence) return
          setSearchResults(matches)
        })
        .catch(() => {
          if (searchSequence.current !== sequence) return
          setSearchResults([])
          setSearchError("The Person directory could not be searched.")
        })
        .finally(() => {
          if (searchSequence.current === sequence) setSearching(false)
        })
    }, 250)

    return () => window.clearTimeout(timer)
  }, [onSearchPeople, searchQuery])

  const createPerson = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending("person")
    setError(null)
    try {
      const person = await onCreatePerson({
        displayName: displayName.trim(),
        email: email.trim(),
      })
      setCreatedPeople((current) => [...current, person])
      setSelectedPerson(person)
      setDisplayName("")
      setEmail("")
      setCreatingPerson(false)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The Person could not be created."
      )
    } finally {
      setPending(null)
    }
  }

  const generate = async () => {
    if (!selectedPerson) return
    setPending("grant")
    setError(null)
    setGeneratedLink(null)
    setCopyStatus("idle")
    try {
      const result = await onGenerate({ personId: selectedPerson.personId })
      if (!result.token) {
        throw new Error(
          "This retry did not return a new token. Generate a new grant to receive a link."
        )
      }
      const link = `${window.location.origin}/respond/${encodeURIComponent(
        result.token
      )}`
      setGeneratedLink(link)
      try {
        await writeClipboard(link)
        setCopyStatus("copied")
      } catch {
        setCopyStatus("manual")
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The Guest Access Grant could not be generated."
      )
    } finally {
      setPending(null)
    }
  }

  const copy = async () => {
    if (!generatedLink) return
    setPending("copy")
    setError(null)
    try {
      await writeClipboard(generatedLink)
      setCopyStatus("copied")
    } catch {
      setCopyStatus("manual")
      document
        .querySelector<HTMLInputElement>("#generated-access-link")
        ?.select()
    } finally {
      setPending(null)
    }
  }

  const showRenewedLink = async (result: GuestAccessGrantCreation) => {
    if (!result.token) throw new Error("Renewal did not return a new token.")
    const link = `${window.location.origin}/respond/${encodeURIComponent(
      result.token
    )}`
    setGeneratedLink(link)
    try {
      await writeClipboard(link)
      setCopyStatus("copied")
    } catch {
      setCopyStatus("manual")
    }
  }

  const renew = async (grantId: string) => {
    if (!onRenew) return
    setLifecyclePending(grantId)
    setError(null)
    try {
      await showRenewedLink(await onRenew(grantId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Renewal failed.")
    } finally {
      setLifecyclePending(null)
    }
  }

  const revoke = async (grantId: string) => {
    if (!onRevoke) return
    setLifecyclePending(grantId)
    setError(null)
    try {
      await onRevoke(grantId)
      setConfirmingRevokeId(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Revocation failed.")
    } finally {
      setLifecyclePending(null)
    }
  }

  return (
    <section
      className="grid gap-5 rounded-3xl border border-border/70 bg-card p-5 shadow-sm"
      aria-labelledby="guest-access-grants-title"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">
            Response links
          </p>
          <h3
            className="mt-1 text-lg font-semibold"
            id="guest-access-grants-title"
          >
            Guest Access Grants
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Assign a no-sign-in response link to one registered Person. The
            assignment cannot be changed after generation.
          </p>
        </div>
        <Badge variant="outline">Expires in 48 hours</Badge>
      </header>

      <div className="grid gap-2">
        <Label htmlFor="guest-access-person">Response recipient</Label>
        <Combobox
          items={options}
          filter={null}
          value={selectedPerson}
          onValueChange={setSelectedPerson}
          onInputValueChange={(inputValue, details) => {
            if (details.reason === "item-press") return
            searchSequence.current += 1
            setSearchQuery(inputValue)
            setSearching(Boolean(inputValue.trim()))
            setSearchError(null)
            if (!inputValue.trim()) setSearchResults([])
          }}
          itemToStringLabel={(person) =>
            `${person.displayName} ${person.email}`
          }
          itemToStringValue={(person) => person.displayName}
          isItemEqualToValue={(person, value) =>
            person.personId === value.personId
          }
        >
          <ComboboxInput
            id="guest-access-person"
            aria-label="Response recipient"
            className="w-full"
            placeholder="Search people by name or email"
            disabled={disabled || pending !== null}
          />
          <ComboboxContent>
            <ComboboxEmpty>
              {searching ? "Searching people…" : "No matching people."}
            </ComboboxEmpty>
            <ComboboxList>
              <ComboboxCollection>
                {(person: GuestAccessPerson) => (
                  <ComboboxItem key={person.personId} value={person}>
                    <UserRound />
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate">
                        {person.displayName}
                      </strong>
                      <span className="block truncate text-xs text-muted-foreground">
                        {person.email}
                      </span>
                    </span>
                    {person.isFounder ? (
                      <Badge variant="secondary">Founder</Badge>
                    ) : null}
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        {searchError ? (
          <p className="text-xs text-destructive" role="alert">
            {searchError}
          </p>
        ) : null}
      </div>

      {creatingPerson ? (
        <form
          className="grid gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4"
          onSubmit={createPerson}
        >
          <div className="flex items-center justify-between gap-3">
            <h4 className="font-semibold">Create a Person</h4>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCreatingPerson(false)}
            >
              Cancel
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="guest-person-name">Display name</Label>
              <Input
                id="guest-person-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="guest-person-email">Email address</Label>
              <Input
                id="guest-person-email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                type="email"
                required
              />
            </div>
          </div>
          <Button
            className="justify-self-start"
            disabled={pending === "person"}
            type="submit"
          >
            {pending === "person" ? "Creating…" : "Create person"}
          </Button>
        </form>
      ) : (
        <Button
          className="justify-self-start"
          disabled={disabled || pending !== null}
          onClick={() => setCreatingPerson(true)}
          type="button"
          variant="outline"
        >
          <Plus /> Add a person
        </Button>
      )}

      <Button
        className="w-full sm:w-fit"
        disabled={disabled || !selectedPerson || pending !== null}
        onClick={() => void generate()}
        type="button"
      >
        <Link2 />
        {pending === "grant" ? "Generating…" : "Generate & copy link"}
      </Button>

      {generatedLink ? (
        <Alert>
          <Check />
          <AlertTitle>Response link generated</AlertTitle>
          <AlertDescription className="grid gap-3">
            <p>
              {copyStatus === "copied"
                ? "Copied to your clipboard."
                : "Automatic copy was blocked. Use the Copy button or select the link."}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                className="font-mono text-xs"
                id="generated-access-link"
                aria-label="Generated access link"
                value={generatedLink}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                aria-label="Copy access link"
                disabled={pending === "copy"}
                onClick={() => void copy()}
                type="button"
                variant="outline"
              >
                <Copy /> Copy
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        FairLend will not send this link. Share it through the channel you
        choose.
      </p>

      {grants.length ? (
        <div className="border-t border-border/70 pt-4">
          <h4 className="text-sm font-semibold">Grant history</h4>
          <ul className="mt-3 grid gap-2">
            {grants.map((grant) => (
              <li
                className="grid gap-3 rounded-2xl bg-muted/35 p-3 text-sm"
                id={`guest-access-${grant.grantId}`}
                key={grant.grantId}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <span>
                    <strong className="block">
                      {grant.person.displayName}
                    </strong>
                    <span className="text-xs text-muted-foreground">
                      {grant.person.email}
                    </span>
                  </span>
                  <span className="text-right text-xs text-muted-foreground">
                    <Badge variant="outline">{grant.state}</Badge>
                    <span className="mt-1 block">
                      Expires{" "}
                      <time dateTime={new Date(grant.expiresAt).toISOString()}>
                        {formatDate(grant.expiresAt)}
                      </time>
                    </span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {grant.progress
                    ? `${grant.progress.completed} of ${grant.progress.total} answered`
                    : "No response progress yet"}
                  {grant.submitted ? " · Submitted" : ""}
                  {grant.latestActivityAt
                    ? ` · Last activity ${formatDate(grant.latestActivityAt)}`
                    : ""}
                </p>
                {grant.events?.length ? (
                  <ol
                    aria-label={`History for ${grant.person.displayName}`}
                    className="flex flex-wrap gap-2 text-xs text-muted-foreground"
                  >
                    {grant.events.map((event, index) => (
                      <li key={`${event.kind}-${event.occurredAt}-${index}`}>
                        {event.kind.replaceAll("_", " ")} by{" "}
                        {event.actorName ?? event.actor} ·{" "}
                        {formatDate(event.occurredAt)}
                      </li>
                    ))}
                  </ol>
                ) : null}
                {onRenew || onRevoke ? (
                  <div className="flex flex-wrap gap-2">
                    {onRenew && grant.state !== "revoked" ? (
                      <Button
                        disabled={lifecyclePending !== null}
                        onClick={() => void renew(grant.grantId)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Renew link
                      </Button>
                    ) : null}
                    {onRevoke && grant.state !== "revoked" ? (
                      confirmingRevokeId === grant.grantId ? (
                        <>
                          <Button
                            disabled={lifecyclePending !== null}
                            onClick={() => void revoke(grant.grantId)}
                            size="sm"
                            type="button"
                            variant="destructive"
                          >
                            Confirm revoke
                          </Button>
                          <Button
                            onClick={() => setConfirmingRevokeId(null)}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          disabled={lifecyclePending !== null}
                          onClick={() => setConfirmingRevokeId(grant.grantId)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Revoke
                        </Button>
                      )
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
