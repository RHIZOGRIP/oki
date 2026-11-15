<script>
  import { onMount } from 'svelte'

  import { get, post } from '$lib/api.js'
  import ModelList from '$lib/ModelList.svelte'
  import Unreached from '$lib/Unreached.svelte'
  import AppPage from '$lib/ui/AppPage.svelte'
  import FormField from '$lib/ui/FormField.svelte'
  import InfoSection from '$lib/ui/InfoSection.svelte'
  import InlineStatus from '$lib/ui/InlineStatus.svelte'
  import PasswordInput from '$lib/ui/PasswordInput.svelte'
  import Tag from '$lib/ui/Tag.svelte'
  import TextInput from '$lib/ui/TextInput.svelte'

  const LOCAL = 'local'
  const RECOMMENDED = ['chatgpt', 'gemini']
  const SIGNS_IN = ['openrouter', 'chatgpt']
  const SERVERS = 'Ollama, llama.cpp, LM Studio, vLLM'

  let setup = $state(null)
  let error = $state('')
  let active = $state(null)
  let expert = $state(false)
  let offers = $state(null)
  let only = $state('known')
  let busy = $state(false)
  let done = $state(null)
  let key = $state('')
  let unverified = $state(false)
  let address = $state('')
  let served = $state(null)
  let unread = $state(null)
  let first = $state('assistant')
  let adopting = $state(null)
  let mine = $state(null)
  let mineUnread = $state(null)
  let added = $state(null)
  let picking = $state(false)

  const problems = $derived(setup?.machine.filter((one) => one.severity === 'problem') ?? [])
  const naming = $derived(Boolean(setup?.model) && !setup.spores.length)
  const settled = $derived(Boolean(setup?.model) && !naming)
  const chosen = $derived(active === null || active === LOCAL ? null : (expert ? setup.expert : setup.choices).find((one) => one.provider === active))

  async function load() {
    const answer = await get('setup')
    if (answer.error) {
      error = answer.error
      return false
    }
    setup = answer
    if (answer.model && answer.spores.length) await listMine()
    return true
  }

  async function listMine() {
    const answer = await get('models')
    if (answer.type === 'MOHDEX_UNREAD') {
      mineUnread = answer.error
      return
    }
    mineUnread = null
    if (answer.error) {
      error = answer.error
      return
    }
    mine = answer
  }

  async function makeDefault(offer) {
    busy = true
    error = ''
    added = null
    const answer = await post('models/default', { model: offer.model })
    busy = false
    if (answer.error) {
      error = answer.error
      return
    }
    await load()
  }

  onMount(async () => {
    const query = new URLSearchParams(location.search)
    if (!(await load())) return
    if (query.has('provider')) {
      history.replaceState(null, '', '/oki/setup/')
      await open(query.get('provider'), false)
      if (query.has('error')) error = query.get('error')
    }
  })

  function reset() {
    error = ''
    offers = null
    unread = null
    key = ''
    unverified = false
    served = null
  }

  async function open(provider, fromExpert) {
    reset()
    added = null
    active = provider
    expert = fromExpert
    only = !fromExpert && RECOMMENDED.includes(provider) ? 'recommended' : 'known'
    if (provider !== LOCAL && provider !== 'expert' && chosen?.credential) await listOffers()
  }

  function back() {
    reset()
    if (expert && active !== 'expert') {
      active = 'expert'
      return
    }
    active = null
    expert = false
  }

  async function listOffers() {
    busy = true
    offers = null
    unread = null
    const answer = await get(`setup/offers?provider=${encodeURIComponent(active)}&only=${only}`)
    busy = false
    if (answer.type === 'MOHDEX_UNREAD') {
      unread = answer.error
      return
    }
    if (answer.error) {
      error = answer.error
      return
    }
    offers = answer
  }

  async function everyModel() {
    only = 'known'
    error = ''
    await listOffers()
  }

  async function signIn() {
    busy = true
    error = ''
    const answer = await post('setup/sign-in', { provider: active })
    busy = false
    if (answer.error) {
      error = answer.error
      return
    }
    location.assign(answer.url)
  }

  async function enterKey(anyway) {
    busy = true
    error = ''
    const answer = await post('setup/key', { provider: active, key, anyway })
    busy = false
    if (answer.error) {
      error = answer.error
      return
    }
    if (!answer.saved) {
      unverified = true
      return
    }
    key = ''
    unverified = false
    await load()
    await listOffers()
  }

  async function listServed() {
    busy = true
    error = ''
    served = null
    const answer = await post('setup/local', { address })
    busy = false
    if (answer.error) {
      error = answer.error
      return
    }
    served = answer.models
  }

  async function choose(body) {
    busy = true
    error = ''
    const answer = await post('setup/choose', body)
    busy = false
    if (answer.error) {
      error = answer.error
      return
    }
    done = answer
    await load()
    if (!settled) return
    reset()
    active = null
    expert = false
    picking = false
    added = answer.added
  }

  async function makeFirst(adopt) {
    busy = true
    error = ''
    const answer = await post('spores', { name: first.trim(), kind: 'default', model: setup.model, adopt })
    busy = false
    if (answer.type === 'FOLDER_HOLDS_FILES') {
      adopting = first
      return
    }
    if (answer.error) {
      error = answer.error
      return
    }
    location.assign('/')
  }
</script>

<svelte:head>
  <title>Oki — models</title>
</svelte:head>

<AppPage
  title={settled ? 'Models' : 'Set up Oki'}
  subtitle={settled ? 'The AI models your spores think with, such as those behind ChatGPT, Claude or Gemini. A new spore runs on the default unless you pick another for it.' : 'Choose the AI model your spores think with'}
  backLabel={active && !naming ? 'Back' : ''}
  onBack={back}
  at={settled ? '/oki/setup/' : null}
>
  {#snippet topRight()}
    {#if setup && !setup.model && !setup.spores.length && active === null}
      <a class="btn" data-style="outline" href="/oki/restore/">Restore a backup</a>
    {/if}
  {/snippet}

  {#if !setup}
    {#if error}
      <InlineStatus tone="danger" role="alert">{error}</InlineStatus>
    {/if}
  {:else if problems.length}
    <InfoSection title="This appliance has a problem">
      {#each problems as one (one.subject)}
        <InlineStatus tone="danger">{one.subject} — {one.problem}</InlineStatus>
        {#if one.fix}<p class="muted">{one.fix}</p>{/if}
      {/each}
      <p>Setup stops here until it is fixed. The System page shows every check.</p>
    </InfoSection>
  {:else if naming}
    <InfoSection title="Name your first spore">
      <InlineStatus tone="success">New spores run on {setup.model}.</InlineStatus>
      {#if done?.readiness.billing === 'metered' && done.readiness.priced === false}
        <InlineStatus tone="warning">mohdel has no prices for this model, so its calls count as $0 against spending limits.</InlineStatus>
      {/if}
      <p>A spore is one of Oki's agents: it keeps its own conversations and memory. This is the one you talk to first; you can add others later. It gets a folder with its name in your Oki folder, the only place on your computer it can reach.</p>
      <form
        class="stack"
        onsubmit={(event) => {
          event.preventDefault()
          makeFirst(false)
        }}
      >
        <FormField label="Name" helperText="Letters, digits, ., _ and -, with no spaces. It is how the spore shows on the chat, and the name of its folder.">
          {#snippet children({ inputProps })}
            <TextInput {...inputProps} bind:value={first} autocomplete="off" />
          {/snippet}
        </FormField>
        {#if adopting !== null && adopting === first}
          <InlineStatus tone="warning">Your Oki folder already has a folder called {first.trim()}, with files in it. The spore would use it, and could change and delete what is there.</InlineStatus>
          <button class="btn" data-color="accent" type="button" disabled={busy} onclick={() => makeFirst(true)}>Create it with that folder</button>
        {:else}
          <button class="btn" data-color="accent" type="submit" disabled={!first.trim() || busy}>Create it and open the chat</button>
        {/if}
      </form>
    </InfoSection>
  {:else if active === null}
    {#if settled}
      <InfoSection title="Your models">
        {#snippet action()}
          {#if !picking}
            <button class="btn" data-style="outline" data-size="sm" type="button" onclick={() => { picking = true; added = null }}>Add models</button>
          {/if}
        {/snippet}
        {#if added}
          <InlineStatus tone="success">Added {added}.</InlineStatus>
        {/if}
        {#if mineUnread}
          <Unreached why={mineUnread} onread={listMine} />
        {:else if mine}
          {#if mine.mohdex}
            <InlineStatus tone="warning">mohdex.dev could not be read ({mine.mohdex}), so nothing here says whether a model is checked against spore.</InlineStatus>
          {/if}
          <ModelList offers={mine.offers} {busy} current={setup.model} action="Make default" onchoose={makeDefault} />
        {:else}
          <p class="muted">Reading…</p>
        {/if}
      </InfoSection>
    {/if}
    {#if !settled || picking}
    <InfoSection title={settled ? 'Add models' : 'Choose a provider'}>
      {#snippet action()}
        {#if settled}
          <button class="btn" data-style="ghost" data-size="sm" type="button" onclick={() => (picking = false)}>Cancel</button>
        {/if}
      {/snippet}
      {#if settled}
        <p class="muted">Set up another provider, or open one you have to add more of its models.</p>
      {:else}
        <p>Oki's agents are called spores, and a spore thinks with an AI model, such as those behind ChatGPT, Claude or Gemini. Pick how Oki reaches one; several cost nothing to try.</p>
      {/if}
    <div class="choices">
      {#each setup.choices as one (one.provider)}
        <button class="choice" type="button" onclick={() => open(one.provider, false)}>
          <span class="title">
            {one.label}
            {#if one.credential}<Tag tone="info" label="set up" />{/if}
          </span>
          <span class="muted">
            {#if one.provider === 'openrouter'}
              Sign in, then pick a model — free ones included. {one.description}
            {:else if one.provider === 'chatgpt'}
              Sign in with an eligible ChatGPT plan, then pick a recommended model. {one.description}
            {:else if one.provider === 'gemini'}
              Paste a key made in Google AI Studio, then pick a model. The no-cost way to try Oki. {one.description}
            {:else}
              Paste a key from {one.label}, then pick a model. {one.description}
            {/if}
          </span>
        </button>
      {/each}
      <button class="choice" type="button" onclick={() => open(LOCAL, false)}>
        <span class="title">Local model</span>
        <span class="muted">A model you already run on an OpenAI-compatible server ({SERVERS}). Free, and nothing leaves your machine.</span>
      </button>
    </div>
      <p>
        <button class="btn" data-style="ghost" type="button" onclick={() => open('expert', true)}>Expert: any provider, any model</button>
      </p>
    </InfoSection>
    {/if}
  {:else if active === 'expert'}
    <InfoSection title="Any provider">
      <p class="muted">Every provider mohdel knows. Models you pick here may not be recommended for spore.</p>
      <div class="choices">
        {#each setup.expert as one (one.provider)}
          <button class="choice" type="button" onclick={() => open(one.provider, true)}>
            <span class="title">
              {one.label}
              {#if one.credential}<Tag tone="info" label="set up" />{/if}
            </span>
            <span class="muted">{one.description}</span>
          </button>
        {/each}
      </div>
    </InfoSection>
  {:else if active === LOCAL}
    <InfoSection title="Local model">
      <InlineStatus tone="warning">A local model is not checked against spore. Spore's conformance runs have not been made on it, so it may fail at tools or at following instructions.</InlineStatus>
      <form
        class="stack"
        onsubmit={(event) => {
          event.preventDefault()
          listServed()
        }}
      >
        <FormField label="Server address" helperText={`The server's OpenAI-compatible address, ending in /v1 — for Ollama, http://<host>:11434/v1. It must be reachable from inside Oki.`}>
          {#snippet children({ inputProps })}
            <TextInput {...inputProps} bind:value={address} placeholder="http://<host>:<port>/v1" />
          {/snippet}
        </FormField>
        <button class="btn" data-color="accent" type="submit" disabled={!address.trim() || busy}>List its models</button>
      </form>
      {#if served}
        {#if served.length}
          <ul class="served">
            {#each served as id (id)}
              <li>
                <span class="key">{id}</span>
                <button class="btn" data-style="outline" data-size="sm" type="button" disabled={busy} onclick={() => choose({ provider: LOCAL, address, id })}>Add this model</button>
              </li>
            {/each}
          </ul>
        {:else}
          <p>The server answers and serves no model. Load one in it, then list again.</p>
        {/if}
      {/if}
    </InfoSection>
  {:else if chosen}
    <InfoSection title={chosen.label}>
      {#if !chosen.credential}
        {#if SIGNS_IN.includes(active)}
          <p>
            {active === 'chatgpt'
              ? 'Sign in with your ChatGPT account and allow plan usage. ChatGPT sends you back here.'
              : 'Sign in to OpenRouter and authorise Oki. OpenRouter makes a key for Oki and sends you back here.'}
          </p>
          <button class="btn" data-color="accent" type="button" disabled={busy} onclick={signIn}>Sign in with {chosen.label}</button>
        {:else}
          <p>{chosen.hint}: <a href={chosen.url} target="_blank" rel="noreferrer">{chosen.url}</a></p>
          <form
            class="stack"
            onsubmit={(event) => {
              event.preventDefault()
              enterKey(false)
            }}
          >
            <FormField label="API key">
              {#snippet children({ inputProps })}
                <PasswordInput {...inputProps} bind:value={key} autocomplete="off" />
              {/snippet}
            </FormField>
            <button class="btn" data-color="accent" type="submit" disabled={!key.trim() || busy}>Check and save the key</button>
          </form>
          {#if unverified}
            <InlineStatus tone="warning">{chosen.label} could not be asked whether the key is good.</InlineStatus>
            <button class="btn" data-style="outline" type="button" disabled={busy} onclick={() => enterKey(true)}>Save it anyway</button>
          {/if}
        {/if}
      {:else if unread}
        <Unreached why={unread} onread={listOffers} />
      {:else if busy && !offers}
        <p class="muted">Reading the models…</p>
      {:else if offers}
        {#if only === 'recommended'}
          <p class="muted">The models spore recommends from {chosen.label}, cheapest first, with mohdex's prices.</p>
        {:else if only === 'known'}
          <p class="muted">Models you can use through {chosen.label}. Some handle an agent's work better than others; the marks say which.</p>
        {/if}
        {#if offers.mohdex}
          <InlineStatus tone="warning">mohdex.dev could not be read ({offers.mohdex}), so nothing here says whether a model is checked against spore.</InlineStatus>
        {/if}
        {#if offers.offers.length}
          <ModelList offers={offers.offers} {busy} action="Add this model" onchoose={(offer) => choose({ provider: active, model: offer.model })} />
        {:else if only === 'recommended'}
          <p>mohdex recommends no {chosen.label} model it has an entry for right now.</p>
        {:else if only === 'known'}
          <p>mohdex has an entry for no {chosen.label} model right now.</p>
        {/if}
        {#if only === 'recommended'}
          <button class="btn" data-style="ghost" type="button" disabled={busy} onclick={everyModel}>Every {chosen.label} model</button>
        {/if}
      {:else if only === 'recommended'}
        <button class="btn" data-style="ghost" type="button" disabled={busy} onclick={everyModel}>Every {chosen.label} model</button>
      {/if}
    </InfoSection>
  {/if}

  {#if setup && error}
    <InlineStatus tone="danger" role="alert">{error}</InlineStatus>
  {/if}
</AppPage>

<style>
  .choices {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: var(--s4);
  }
  .choice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s2);
    padding: var(--s4);
    text-align: left;
    font: inherit;
    color: inherit;
    background: var(--bg);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-large);
    cursor: pointer;
  }
  .choice:hover {
    border-color: var(--border);
  }
  .title {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--s2);
    font-weight: 600;
  }
  .stack {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s4);
    margin-block: var(--s4);
  }
  .stack :global(.field) {
    align-self: stretch;
  }
  .served {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .served li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--s3) 0;
    border-bottom: 1px solid var(--hairline);
  }
  .key {
    font-family: var(--font-mono);
  }
  .muted {
    color: var(--text-muted);
  }
</style>
