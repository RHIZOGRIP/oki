<script>
  import { onMount } from 'svelte'

  import { get, upload } from '$lib/api.js'
  import AppPage from '$lib/ui/AppPage.svelte'
  import FormField from '$lib/ui/FormField.svelte'
  import InfoSection from '$lib/ui/InfoSection.svelte'
  import InlineStatus from '$lib/ui/InlineStatus.svelte'
  import PasswordInput from '$lib/ui/PasswordInput.svelte'

  let page = $state(null)
  let error = $state('')
  let file = $state(null)
  let passphrase = $state('')
  let importing = $state(false)
  let done = $state(null)

  onMount(async () => {
    const answer = await get('import')
    if (answer.error) error = answer.error
    else page = answer
  })

  async function bring(event) {
    event.preventDefault()
    error = ''
    importing = true
    const answer = await upload('import', file, { 'x-oki-passphrase': encodeURIComponent(passphrase) })
    importing = false
    if (answer.error) {
      error = answer.error
      return
    }
    done = answer
  }

  const when = (iso) => new Date(iso).toLocaleString()
</script>

<svelte:head>
  <title>Oki — restore</title>
</svelte:head>

<AppPage title="Restore" subtitle="Bring a backup into this new Oki" width="narrow">
  {#if done}
    <InfoSection title="Restored">
      <InlineStatus tone="success">A backup of Oki {done.record.release}, made {when(done.record.exported)}, is installed.</InlineStatus>
      <p>{done.spores.length ? `Your spores: ${done.spores.join(', ')}.` : 'The backup held no spore.'} If that Oki had a password, sign in with it now.</p>
      <p>Once this Oki works as you expect, you can remove the one the backup came from.</p>
      <p><a class="btn" data-color="accent" href="/oki/" data-sveltekit-reload>Open Oki</a></p>
    </InfoSection>
  {:else if page?.held.length}
    <InfoSection title="This Oki is in use">
      <p>It already holds {page.held.join(', ')}. A backup is restored only into a new Oki, so nothing here is replaced.</p>
      <p>To restore into a fresh Oki, install it again and restore there.</p>
    </InfoSection>
  {:else if page}
    <InfoSection title="Before you restore">
      <InlineStatus tone="warning">Stop the Oki the backup came from. Two running with the same spores would both act: both would run your schedules and answer as you.</InlineStatus>
      <p>The restore installs everything the backup holds: spores, conversations, model access, and the password, if that Oki had one.</p>
      <p>The backup is unpacked here before anything is installed, so this Oki needs room for it. A wrong passphrase or a damaged file changes nothing.</p>
    </InfoSection>

    <form class="stack" onsubmit={bring}>
      <FormField label="Backup file">
        {#snippet children({ inputProps })}
          <input {...inputProps} type="file" onchange={(event) => (file = event.currentTarget.files[0] ?? null)} />
        {/snippet}
      </FormField>
      <FormField label="Passphrase" helperText="The one typed when the backup was written. Leave it blank for a backup written without one.">
        {#snippet children({ inputProps })}
          <PasswordInput {...inputProps} bind:value={passphrase} autocomplete="off" />
        {/snippet}
      </FormField>
      <button class="btn" data-color="accent" type="submit" disabled={!file || importing}>Restore</button>
    </form>
    {#if importing}
      <InlineStatus tone="info">Restoring — reading the file, checking it whole, then installing it.</InlineStatus>
    {/if}
  {/if}

  {#if error}
    <InlineStatus tone="danger" role="alert">{error}</InlineStatus>
  {/if}
</AppPage>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s4);
    margin-block: var(--s5);
  }
  .stack :global(.field) {
    align-self: stretch;
  }
</style>
