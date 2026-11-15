<script>
  import { onMount } from 'svelte'

  import { get } from '$lib/api.js'
  import AppPage from '$lib/ui/AppPage.svelte'
  import Checkbox from '$lib/ui/Checkbox.svelte'
  import FormField from '$lib/ui/FormField.svelte'
  import InfoSection from '$lib/ui/InfoSection.svelte'
  import InlineStatus from '$lib/ui/InlineStatus.svelte'
  import PasswordInput from '$lib/ui/PasswordInput.svelte'

  let status = $state(null)
  let error = $state('')
  let passphrase = $state('')
  let again = $state('')
  let unencrypted = $state(false)
  let writing = $state(false)

  const differ = $derived(again !== '' && again !== passphrase)
  const ready = $derived(passphrase === again && (passphrase !== '' || unencrypted))

  async function read() {
    const answer = await get('export')
    if (answer.error) error = answer.error
    else status = answer
    return answer
  }

  onMount(() => {
    const query = new URLSearchParams(location.search)
    if (query.has('error')) {
      error = query.get('error')
      history.replaceState(null, '', '/oki/backup/')
    }
    read()
  })

  async function follow() {
    const before = status?.last?.at
    error = ''
    writing = true
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const answer = await read()
      if (answer.error || (!answer.busy && answer.last?.at !== before)) break
    }
    writing = false
    passphrase = ''
    again = ''
    unencrypted = false
  }

  const when = (iso) => new Date(iso).toLocaleString()
  const size = (bytes) => (bytes < 1e6 ? `${Math.ceil(bytes / 1e3)} kB` : `${(bytes / 1e6).toFixed(1)} MB`)
</script>

<svelte:head>
  <title>Oki — back up</title>
  <meta name="referrer" content="same-origin" />
</svelte:head>

<AppPage title="Back up" subtitle="Everything Oki keeps, in one file" at="/oki/backup/">

  <div class="sections">
    <InfoSection title="What the file holds" folded>
      <p>
        Your spores with their conversations, memories and schedules, the chat's history, the model access you set up, keys and sign-ins
        included, and Oki's password: everything in Oki's home directory but its caches.
      </p>
      <p>It does not hold your Oki folder, where each spore has its own. Those files are on your computer already and stay there.</p>
      <p>While the file is written Oki stops its services, so the chat pauses for that time. A spore in the middle of a turn is not cut short: Oki refuses the backup until the turn has finished.</p>
    </InfoSection>

    <InfoSection title="Passphrase">
      <form class="stack" method="post" action="/oki/api/export" onsubmit={follow}>
        <FormField label="Passphrase" helperText="Oki encrypts the file with it and keeps it nowhere. Lose it and nobody can open this backup, you included.">
          {#snippet children({ inputProps })}
            <PasswordInput {...inputProps} name="passphrase" bind:value={passphrase} autocomplete="new-password" />
          {/snippet}
        </FormField>
        <FormField label="The same passphrase again" error={differ ? 'The two passphrases differ.' : ''}>
          {#snippet children({ inputProps })}
            <PasswordInput {...inputProps} name="again" bind:value={again} autocomplete="new-password" />
          {/snippet}
        </FormField>
        {#if passphrase === '' && again === ''}
          <Checkbox bind:checked={unencrypted} name="unencrypted" value="yes" label="Write it without encryption. The file then holds my keys and sign-ins in the clear." />
        {/if}
        <button class="btn" data-color="accent" type="submit" disabled={!ready || writing}>Write the backup</button>
      </form>

      {#if writing}
        <InlineStatus tone="info">Writing the backup — your browser saves it as it arrives.</InlineStatus>
      {:else if status?.last?.failed}
        <InlineStatus tone="danger">The backup at {when(status.last.at)} failed — {status.last.failed}. Your browser marks that download failed; keep none of it.</InlineStatus>
      {:else if status?.last}
        <InlineStatus tone="success">Written at {when(status.last.at)}: {status.last.file}, {size(status.last.bytes)}{status.last.encrypted ? '' : ', not encrypted'}.</InlineStatus>
      {/if}
      {#if error}
        <InlineStatus tone="danger" role="alert">{error}</InlineStatus>
      {/if}
    </InfoSection>

    <InfoSection title="Keep it safe">
      <p>The file is in your browser's downloads. Copy it somewhere other than this computer too, a USB drive or another machine: a copy here does not survive losing the computer.</p>
    </InfoSection>

    <InfoSection title="Moving to a new release">
      <ol>
        <li>Back up here, and keep the file.</li>
        <li>Install the new release of Oki. It starts empty.</li>
        <li>Stop this Oki.</li>
        <li>Open the new one and restore the file there.</li>
      </ol>
      <p>This Oki stays as it is: until you remove it, going back is starting it again. What the new one does after the restore is not in this one.</p>
    </InfoSection>
  </div>
</AppPage>

<style>
  .sections {
    display: flex;
    flex-direction: column;
    gap: var(--s5);
  }
  .stack {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s4);
    margin-bottom: var(--s4);
  }
  .stack :global(.field) {
    align-self: stretch;
  }
</style>
