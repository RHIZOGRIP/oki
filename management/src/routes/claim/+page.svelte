<script>
  import { post } from '$lib/api.js'
  import Logo from '$lib/Logo.svelte'
  import FormField from '$lib/ui/FormField.svelte'
  import InlineStatus from '$lib/ui/InlineStatus.svelte'
  import ModeSwitch from '$lib/ui/ModeSwitch.svelte'
  import PasswordInput from '$lib/ui/PasswordInput.svelte'

  let password = $state('')
  let again = $state('')
  let error = $state('')
  const differ = $derived(again !== '' && again !== password)

  async function claim(chosen) {
    error = ''
    const answer = await post('claim', { password: chosen })
    if (answer.error) {
      error = answer.error
      return
    }
    location.replace('/oki/')
  }
</script>

<svelte:head>
  <title>Claim Oki</title>
</svelte:head>

<div class="mode"><ModeSwitch /></div>

<div class="claim">
  <header class="brand">
    <div class="logo"><Logo /></div>
    <h1>Your own AI agent, on your own computer.</h1>
    <p>Oki runs on your computer, not on someone else's, and it works only in the folder you give it.</p>
    <ul>
      <li>Your conversations and your files stay with you.</li>
      <li>You choose the AI model, and you can start free.</li>
    </ul>
    <p class="step">Oki is new on this machine. First, choose whether it asks for a password.</p>
  </header>

  <div class="choices">
    <form
      class="password"
      onsubmit={(event) => {
        event.preventDefault()
        claim(password)
      }}
    >
      <FormField label="Password" helperText="Asked before Oki shows anything, the chat included.">
        {#snippet children({ inputProps })}
          <PasswordInput {...inputProps} bind:value={password} autocomplete="new-password" />
        {/snippet}
      </FormField>
      <FormField label="The same password again" error={differ ? 'The two passwords differ.' : ''}>
        {#snippet children({ inputProps })}
          <PasswordInput {...inputProps} bind:value={again} autocomplete="new-password" />
        {/snippet}
      </FormField>
      <button class="btn" data-color="accent" type="submit" disabled={!password || password !== again}>
        Set the password
      </button>
    </form>

    <section class="other">
      <p>
        Without a password, anyone who can open this machine's local address can use Oki. On a computer
        only you use, that is a reasonable choice.
      </p>
      <button class="btn" data-style="outline" type="button" onclick={() => claim(null)}>
        Continue without a password
      </button>
    </section>

    <section class="other">
      <p>Already used Oki on another computer or an earlier release? Restore its backup instead of starting empty.</p>
      <a class="btn" data-style="outline" href="/oki/restore/">Restore a backup</a>
    </section>

    {#if error}
      <InlineStatus tone="danger" role="alert">{error}</InlineStatus>
    {/if}
  </div>
</div>

<style>
  .mode {
    position: absolute;
    top: var(--s2);
    right: var(--s4);
  }
  .claim {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    align-items: center;
    gap: var(--s7);
    max-width: 56rem;
    min-height: 100dvh;
    margin-inline: auto;
    padding: var(--s5) var(--s4);
  }
  .brand {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
  }
  .logo {
    width: 7rem;
  }
  .brand h1 {
    font-size: var(--size-display);
    font-weight: 600;
    line-height: 1.2;
  }
  .brand p,
  .brand li {
    font-size: var(--size-prose);
    color: var(--text-muted);
  }
  .brand ul {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
    padding-left: var(--s5);
  }
  .brand .step {
    margin-top: var(--s3);
    color: var(--text);
  }
  .choices {
    display: flex;
    flex-direction: column;
    gap: var(--s4);
    padding: var(--s5);
    border-radius: var(--radius-large);
    background: var(--raised);
    box-shadow: var(--shadow-mid);
  }
  .password {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s3);
  }
  .password :global(.field) {
    align-self: stretch;
  }
  .other {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s3);
    padding-top: var(--s4);
    border-top: 1px solid var(--hairline);
  }
  .other p {
    flex: 1 1 14rem;
    font-size: var(--size-ui);
    color: var(--text-muted);
  }
  @media (max-width: 56rem) {
    .claim {
      grid-template-columns: 1fr;
      align-items: start;
      min-height: 0;
      gap: var(--s5);
    }
  }
</style>
