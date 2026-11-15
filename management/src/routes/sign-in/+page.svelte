<script>
  import { post } from '$lib/api.js'
  import AppPage from '$lib/ui/AppPage.svelte'
  import FormField from '$lib/ui/FormField.svelte'
  import InlineStatus from '$lib/ui/InlineStatus.svelte'
  import PasswordInput from '$lib/ui/PasswordInput.svelte'

  let password = $state('')
  let error = $state('')

  async function signIn(event) {
    event.preventDefault()
    error = ''
    const answer = await post('sign-in', { password })
    if (answer.error) {
      error = answer.error
      return
    }
    location.replace('/oki/')
  }
</script>

<svelte:head>
  <title>Sign in to Oki</title>
</svelte:head>

<AppPage title="Sign in to Oki" width="narrow">
  <form class="stack" onsubmit={signIn}>
    <FormField label="Password">
      {#snippet children({ inputProps })}
        <PasswordInput {...inputProps} bind:value={password} autocomplete="current-password" />
      {/snippet}
    </FormField>
    <button class="btn" data-color="accent" type="submit" disabled={!password}>Sign in</button>
    {#if error}
      <InlineStatus tone="danger" role="alert">{error}</InlineStatus>
    {/if}
  </form>
</AppPage>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s4);
  }
  .stack :global(.field) {
    align-self: stretch;
  }
</style>
