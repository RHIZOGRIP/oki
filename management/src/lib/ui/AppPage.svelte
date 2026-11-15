<script>
  import Logo from '$lib/Logo.svelte'
  import DiscordLink from '$lib/ui/DiscordLink.svelte'
  import ModeSwitch from '$lib/ui/ModeSwitch.svelte'

  const LINKS = [
    { href: '/oki/spores/', label: 'Spores' },
    { href: '/oki/setup/', label: 'Models' },
    { href: '/oki/backup/', label: 'Back up' },
    { href: '/oki/', label: 'System' }
  ]

  let { title, subtitle = '', width = 'default', backLabel = '', onBack = undefined, at = null, topRight, children } = $props()
</script>

<header class="top">
  <a class="home" href="/oki/" aria-label="Oki"><Logo /></a>
  {#if at}
    <nav class="links" aria-label="Oki">
      {#each LINKS as link (link.href)}
        <a href={link.href} aria-current={link.href === at ? 'page' : undefined}>{link.label}</a>
      {/each}
    </nav>
  {/if}
  <div class="actions">
    {#if at}
      <a class="btn" data-color="accent" href="/">Open chat</a>
    {:else}
      {@render topRight?.()}
    {/if}
    <DiscordLink />
    <ModeSwitch />
  </div>
</header>

<div class="page" data-width={width}>
  {#if backLabel}
    <button class="back" type="button" onclick={onBack}><span aria-hidden="true">←</span> {backLabel}</button>
  {/if}
  <div class="heading">
    <h1>{title}</h1>
    {#if subtitle}
      <p>{subtitle}</p>
    {/if}
  </div>
  {@render children?.()}
</div>

<style>
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s2);
    min-height: 48px;
    padding: var(--s2) var(--s4);
    border-bottom: 1px solid var(--hairline);
  }
  .home {
    display: block;
    width: 44px;
    line-height: 0;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    flex: 1;
    gap: var(--s1);
    padding-left: var(--s3);
  }
  .links a {
    padding: var(--s1) var(--s3);
    border-radius: var(--radius-small);
    color: var(--text-muted);
    text-decoration: none;
  }
  .links a:hover {
    background: var(--hover);
    color: var(--text);
  }
  .links a[aria-current='page'] {
    color: var(--text);
    font-weight: 500;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s2);
  }
  .page {
    max-width: var(--column);
    margin-inline: auto;
    padding: var(--s6) var(--s4) var(--s7);
  }
  .page[data-width='narrow'] {
    max-width: 30rem;
  }
  .page[data-width='wide'] {
    max-width: 64rem;
  }
  .page > :global(* + *) {
    margin-top: var(--s5);
  }
  .back {
    display: block;
    padding: 0;
    border: 0;
    background: none;
    font-size: var(--size-ui);
    color: var(--text-muted);
  }
  .back:hover {
    color: var(--text);
  }
  .heading {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
  }
  h1 {
    font-size: var(--size-title);
    font-weight: 600;
    line-height: 1.25;
  }
  .heading p {
    color: var(--text-muted);
  }
</style>
