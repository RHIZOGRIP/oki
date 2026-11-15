<script>
  import { onMount } from 'svelte'

  import { get, post } from '$lib/api.js'
  import Deprecations from '$lib/Deprecations.svelte'
  import Unreached from '$lib/Unreached.svelte'
  import AppPage from '$lib/ui/AppPage.svelte'
  import FormField from '$lib/ui/FormField.svelte'
  import InfoSection from '$lib/ui/InfoSection.svelte'
  import InlineStatus from '$lib/ui/InlineStatus.svelte'
  import Radio from '$lib/ui/Radio.svelte'
  import RadioGroup from '$lib/ui/RadioGroup.svelte'
  import Row from '$lib/ui/Row.svelte'
  import Tag from '$lib/ui/Tag.svelte'
  import TextInput from '$lib/ui/TextInput.svelte'

  const KINDS = {
    default: { label: 'General', description: 'An assistant for whatever you bring it — answers questions, works on your files, gets tasks done, and keeps notes for next time.' },
    perennial: { label: 'Long-lived', description: 'An assistant that stays on the job between your messages — learns how you work, follows up without being asked, and keeps itself organised.' }
  }
  const isFree = (offer) => offer.free === true || (offer.price?.input === 0 && offer.price?.output === 0)

  let page = $state(null)
  let error = $state('')
  let busy = $state(false)
  let name = $state('')
  let kind = $state('default')
  let model = $state(null)
  let models = $state(null)
  let unread = $state(null)
  let made = $state(null)
  let asking = $state(null)
  let adopting = $state(null)
  let adding = $state(false)
  let refused = $state(null)
  let removed = $state(null)

  const labels = $derived(new Map(models?.offers.map((offer) => [offer.model, offer.label]) ?? []))
  const retired = $derived(new Set(page?.deprecations.map((one) => one.model) ?? []))

  async function load() {
    const answer = await get('spores')
    if (answer.error) {
      error = answer.error
      return
    }
    page = answer
    model ??= answer.model
  }

  onMount(async () => {
    await load()
    await listModels()
  })

  async function listModels() {
    const answer = await get('models')
    if (answer.type === 'MOHDEX_UNREAD') {
      unread = answer.error
      return
    }
    unread = null
    if (answer.error) {
      error = answer.error
      return
    }
    models = answer
  }

  async function create(adopt) {
    busy = true
    error = ''
    made = null
    const answer = await post('spores', { name: name.trim(), kind, model, adopt })
    busy = false
    if (answer.type === 'FOLDER_HOLDS_FILES') {
      adopting = name
      return
    }
    if (answer.error) {
      error = answer.error
      return
    }
    adopting = null
    adding = false
    name = ''
    await load()
    made = answer
  }

  async function remove(spore, yes) {
    busy = true
    error = ''
    refused = null
    removed = null
    const answer = await post('spores/remove', { name: spore, yes })
    busy = false
    asking = null
    if (answer.type === 'SPORE_HAS_TURNS') {
      asking = { name: spore, said: answer.error }
      return
    }
    if (answer.error) {
      refused = { name: spore, running: answer.type === 'SPORE_RUNNING', said: answer.error }
      return
    }
    await load()
    removed = answer
  }
</script>

<svelte:head>
  <title>Oki — spores</title>
</svelte:head>

<AppPage title="Spores" subtitle="A spore is one of Oki's agents: it has a name, keeps its own conversations and memory, and thinks with an AI model." at="/oki/spores/">
  {#if !page}
    {#if error}
      <InlineStatus tone="danger" role="alert">{error}</InlineStatus>
    {:else}
      <p class="muted">Reading…</p>
    {/if}
  {:else}
    <div class="sections">
      <Deprecations offers={page.deprecations} onmoved={load} />

      <InfoSection title="Your spores">
        {#snippet action()}
          {#if !adding}
            <button class="btn" data-style="outline" data-size="sm" type="button" onclick={() => { adding = true; made = null }}>New spore</button>
          {/if}
        {/snippet}
        {#if !page.spores.length}
          <p>Oki has no spore yet.</p>
        {/if}
        {#if made}
          <InlineStatus tone="success">Created {made.name}. Talk to it in the chat.</InlineStatus>
        {/if}
        <ul class="spores">
          {#each page.spores as spore (spore.name)}
            <Row title={spore.name}>
              {#snippet tags()}
                {#if !spore.error}
                  <Tag tone={spore.running ? 'info' : spore.state === 'failed' || spore.state === 'crashed' ? 'danger' : 'neutral'} label={spore.state} />
                  {#if retired.has(spore.model)}
                    <Tag tone="warning" label="retired model" />
                  {/if}
                {/if}
              {/snippet}
              {#snippet detail()}
                {#if spore.error}
                  <InlineStatus tone="danger">{spore.error}</InlineStatus>
                {:else}
                  {KINDS[spore.kind]?.label ?? spore.kind} · {labels.get(spore.model) ?? spore.model}
                {/if}
              {/snippet}
              {#snippet action()}
                <button class="btn" data-style="outline" data-size="sm" type="button" disabled={busy} onclick={() => remove(spore.name, false)}>Delete</button>
              {/snippet}
            </Row>
            {#if asking?.name === spore.name}
              <li class="ask">
                <InlineStatus tone="warning">{asking.said}.</InlineStatus>
                <p>Deleting it removes its conversation, its records and everything it kept for itself. Its folder in your Oki folder is not touched.</p>
                <div class="actions">
                  <button class="btn" data-color="danger" type="button" disabled={busy} onclick={() => remove(spore.name, true)}>Delete {spore.name} anyway</button>
                  <button class="btn" data-style="outline" type="button" disabled={busy} onclick={() => (asking = null)}>Keep it</button>
                </div>
              </li>
            {/if}
            {#if refused?.name === spore.name}
              <li class="ask">
                <InlineStatus tone="danger">
                  {refused.running ? `${spore.name} is in a turn, and spore deletes a spore only between turns — ` : `${spore.name} was not deleted — `}{refused.said}
                </InlineStatus>
              </li>
            {/if}
          {/each}
        </ul>
        {#if removed}
          <InlineStatus tone="success">Deleted {removed.ws} — {removed.turns} turn(s), ${removed.treeUsd.toFixed(4)}.</InlineStatus>
        {/if}
      </InfoSection>

      {#if adding}
        <InfoSection title="New spore">
        <form
          class="stack"
          onsubmit={(event) => {
            event.preventDefault()
            create(false)
          }}
        >
          <FormField label="Name" helperText="Letters, digits, ., _ and -. It is the spore's name in the chat, and the name of its folder in your Oki folder.">
            {#snippet children({ inputProps })}
              <TextInput {...inputProps} bind:value={name} placeholder="notes" />
            {/snippet}
          </FormField>
          <RadioGroup bind:value={kind} name="kind" legend="Kind">
            {#each page.kinds as one (one.name)}
              <Radio value={one.name} label={KINDS[one.name].label} description={KINDS[one.name].description} />
            {/each}
          </RadioGroup>
          {#if unread}
            <Unreached why={unread} onread={listModels} />
          {:else if models}
            <FormField label="Model">
              {#snippet children({ inputProps })}
                <select class="select" {...inputProps} bind:value={model}>
                  {#each models.offers as offer (offer.model)}
                    <option value={offer.model}>{offer.label}{isFree(offer) ? ' — free' : ''}{offer.model === page.model ? ' (default)' : ''}</option>
                  {/each}
                </select>
              {/snippet}
            </FormField>
          {/if}
          {#if adopting !== null && adopting === name}
            <InlineStatus tone="warning">Your Oki folder already has a folder called {name.trim()}, with files in it. The spore would use it, and could change and delete what is there.</InlineStatus>
            <button class="btn" data-color="accent" type="button" disabled={busy} onclick={() => create(true)}>Create it with that folder</button>
          {:else}
            <div class="actions">
              <button class="btn" data-color="accent" type="submit" disabled={busy || !name.trim() || !model}>Create the spore</button>
              <button class="btn" data-style="ghost" type="button" disabled={busy} onclick={() => (adding = false)}>Cancel</button>
            </div>
          {/if}
        </form>
      </InfoSection>
      {/if}
    </div>
    {#if error}
      <InlineStatus tone="danger" role="alert">{error}</InlineStatus>
    {/if}
  {/if}
</AppPage>

<style>
  .sections {
    display: flex;
    flex-direction: column;
    gap: var(--s5);
  }
  .spores {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .spores li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s4);
    padding: var(--s3) 0;
    border-bottom: 1px solid var(--hairline);
  }
  .spores li.ask {
    flex-direction: column;
    align-items: flex-start;
  }
  .stack {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s4);
  }
  .stack :global(.field) {
    align-self: stretch;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s3);
  }
  .muted {
    color: var(--text-muted);
  }
  .select {
    width: 100%;
    min-height: 32px;
    padding: 6px var(--s3);
    border: 1px solid var(--border);
    border-radius: var(--radius-small);
    background: var(--bg);
  }
  @media (pointer: coarse) {
    .select {
      min-height: 44px;
    }
  }
</style>
