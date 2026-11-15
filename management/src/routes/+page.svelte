<script>
  import { onMount } from 'svelte'

  import { get, post } from '$lib/api.js'
  import Deprecations from '$lib/Deprecations.svelte'
  import Unreached from '$lib/Unreached.svelte'
  import AppPage from '$lib/ui/AppPage.svelte'
  import InfoSection from '$lib/ui/InfoSection.svelte'
  import InlineStatus from '$lib/ui/InlineStatus.svelte'
  import Tag from '$lib/ui/Tag.svelte'

  let system = $state(null)
  let model = $state(null)
  let doctor = $state(null)
  let catalog = $state(null)
  let error = $state('')

  const refused = $derived(doctor?.boundary.filter((one) => one.outcome === 'refused').length ?? 0)

  const read = async (route, keep) => {
    const answer = await get(route)
    if (answer.error) error = answer.error
    else keep(answer)
  }

  onMount(() => {
    read('system', (answer) => (system = answer))
    read('model', (answer) => (model = answer))
    read('doctor', (answer) => (doctor = answer))
    read('catalog', (answer) => (catalog = answer))
  })

  async function moved() {
    await read('model', (answer) => (model = answer))
    await read('catalog', (answer) => (catalog = answer))
  }

  const when = (iso) => new Date(iso).toLocaleString()
  const gigabytes = (bytes) => `${(bytes / 1e9).toFixed(1)} GB`
  const full = $derived(system ? Math.round((system.space.used / system.space.size) * 100) : 0)

  async function signOut() {
    const answer = await post('sign-out', {})
    if (answer.error) {
      error = answer.error
      return
    }
    location.replace('/oki/')
  }

  function billing(state) {
    if (state.billing === 'capacity') return 'your own server — no cost per token'
    if (state.billing === 'plan') return 'your plan — not metered'
    if (state.free) return 'free'
    if (state.priced === false) return 'metered, and mohdel has no prices for it: its calls count as $0 against spending limits'
    return 'metered, priced per token'
  }
</script>

<svelte:head>
  <title>Oki — system</title>
</svelte:head>

<AppPage title="System" subtitle="How this Oki is running" at="/oki/">

  {#if error}
    <InlineStatus tone="danger" role="alert">{error}</InlineStatus>
  {/if}

  <div class="sections">
    {#if catalog}
      <Deprecations offers={catalog.deprecations} onmoved={moved} />
    {/if}

    <InfoSection title="Models">
      {#if !model}
        <p class="muted">Reading…</p>
      {:else if !model.model}
        <InlineStatus tone="warning">No model is set for new spores.</InlineStatus>
      {:else}
        <p>New spores run on <strong>{model.model.name}</strong> — {billing(model.model)}.</p>
        {#if model.model.retired}
          <InlineStatus tone="warning">Retired — the offer above moves new spores to another model.</InlineStatus>
        {:else if !model.model.ready}
          <InlineStatus tone="danger">Not ready — {model.model.credential ? 'the model is not in the catalog' : 'its provider has no credential'}.</InlineStatus>
        {/if}
      {/if}
      {#if model && !model.model}
        <p><a class="btn" data-style="outline" href="/oki/setup/">Set up a model</a></p>
      {/if}
    </InfoSection>

    {#if catalog}
      <InfoSection title="Model catalog">
        {#if catalog.unread}
          <Unreached why={catalog.unread} onread={() => read('catalog', (answer) => (catalog = answer))} />
        {:else}
          <p>
            The catalog holds the models Oki computed from mohdex, <span class="mono">{catalog.url}</span>, installed {when(catalog.installed.at)}, and the models you chose. While you use Oki, it reads mohdex
            again once its copy is more than {catalog.stale / 3600000} hours old, and installs what changed.
          </p>
          {#if catalog.failed}
            <InlineStatus tone="warning">At {when(catalog.failed.at)}: {catalog.failed.why}. The catalog stays as it is.</InlineStatus>
          {:else if catalog.checked}
            <InlineStatus tone="success">Up to date, checked {when(catalog.checked)}.</InlineStatus>
          {/if}
        {/if}
      </InfoSection>
    {/if}

    <InfoSection title="Services">
      {#if system}
        {#if system.connector.answering}
          <InlineStatus tone="success">The chat answers at {system.connector.listen}</InlineStatus>
        {:else}
          <InlineStatus tone="danger">The chat does not answer at {system.connector.listen} — {system.connector.detail}</InlineStatus>
        {/if}
        {#if system.services.none}
          <p class="muted">{system.services.none}</p>
        {:else}
          <dl>
            {#each system.services.rows as row (row.name)}
              <dt class="mono">{row.name}</dt>
              <dd>
                <Tag tone={row.active === 'active' ? 'success' : 'danger'} label={`${row.active} (${row.sub})`} />
                {row.enabled ? 'starts with Oki' : 'does not start with Oki'}
              </dd>
            {/each}
          </dl>
        {/if}
      {/if}
    </InfoSection>

    {#if system}
      <InfoSection title="Space">
        {#if full > 60}
          <InlineStatus tone="warning">{full}% full — Oki and its spores use {gigabytes(system.space.used)} of {gigabytes(system.space.size)}.</InlineStatus>
          <p>Ask your spores in the chat to clean up and organise what they keep. When the space is nearly full, spores stop working. Files in your folders are on your computer and do not count.</p>
        {:else}
          <p>Oki and its spores use {gigabytes(system.space.used)} of {gigabytes(system.space.size)}. Files in your folders are on your computer and do not count.</p>
        {/if}
      </InfoSection>
    {/if}

    <InfoSection title="Checks">
      {#if !doctor}
        <p class="muted">spore doctor is running…</p>
      {:else}
        {#if doctor.findings.length}
          {#each doctor.findings as one, at (at)}
            <InlineStatus tone={one.severity === 'problem' ? 'danger' : 'info'}>{one.area} · {one.subject} — {one.problem}</InlineStatus>
            {#if one.fix}<p class="muted fix">{one.fix}</p>{/if}
          {/each}
        {:else}
          <InlineStatus tone="success">This appliance, its configuration and its spores — nothing to fix.</InlineStatus>
        {/if}
        {#if doctor.boundary.length}
          {#if refused === doctor.boundary.length}
            <InlineStatus tone="success">Protected — Oki tried {refused} ways for a spore to reach outside its own space, and all were blocked.</InlineStatus>
          {:else}
            <InlineStatus tone="danger">Not protected — Oki tried {doctor.boundary.length} ways for a spore to reach outside its own space, and only {refused} were blocked.</InlineStatus>
          {/if}
          <details open={refused !== doctor.boundary.length}>
            <summary>What was tried</summary>
            <ul class="boundary">
              {#each doctor.boundary as one, at (at)}
                <li><Tag tone={one.outcome === 'refused' ? 'success' : 'danger'} label={one.outcome === 'refused' ? 'blocked' : 'not blocked'} /> {one.outcome !== 'refused' && one.why ? `${one.tried} — ${one.why}` : one.tried}</li>
              {/each}
            </ul>
          </details>
        {/if}
      {/if}
    </InfoSection>

    <InfoSection title="Questions">
      <p>
        Ask the people who make Oki, and others who use it, on
        <a href="https://discord.gg/gpumegdhR" target="_blank" rel="noreferrer">Oki's Discord</a>.
      </p>
    </InfoSection>

    {#if system}
      <InfoSection title="Release {system.release.release}" folded>
        <dl class="release">
          <dt>Release</dt>
          <dd>{system.release.release}</dd>
          <dt>Built</dt>
          <dd>{system.release.built}</dd>
          <dt>spore</dt>
          <dd>{system.release.spore}</dd>
          <dt>mohdel</dt>
          <dd>{system.release.mohdel}</dd>
          <dt>Web connector</dt>
          <dd>{system.release.connector}</dd>
          <dt>Management</dt>
          <dd>{system.release.management}</dd>
          <dt>Node.js</dt>
          <dd>{system.release.node}</dd>
          <dt>Architecture</dt>
          <dd>{system.release.arch}</dd>
          <dt>Data schema</dt>
          <dd>{system.release.dataSchema}</dd>
        </dl>
      </InfoSection>

      <InfoSection title="Access">
        {#if system.password}
          <p>Oki asks for a password.</p>
          <button class="btn" data-style="outline" type="button" onclick={signOut}>Sign out</button>
        {:else}
          <p>Oki asks for no password.</p>
        {/if}
      </InfoSection>
    {/if}
  </div>
</AppPage>

<style>
  .sections {
    display: flex;
    flex-direction: column;
    gap: var(--s5);
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--s2) var(--s4);
    margin: 0;
  }
  dd {
    margin: 0;
  }
  .mono,
  .release dd {
    font-family: var(--font-mono);
  }
  .muted {
    color: var(--text-muted);
  }
  .fix {
    margin: 0 0 var(--s3) var(--s5);
  }
  summary {
    cursor: pointer;
    font-size: var(--size-ui);
    color: var(--text-muted);
  }
  .boundary {
    list-style: none;
    padding: 0;
    margin: var(--s2) 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
</style>
