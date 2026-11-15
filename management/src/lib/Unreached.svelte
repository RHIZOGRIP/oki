<script>
  import { post } from '$lib/api.js'
  import InlineStatus from '$lib/ui/InlineStatus.svelte'

  let { why, onread } = $props()

  let busy = $state(false)
  let latest = $state(null)
  let error = $state('')

  const shown = $derived(latest ?? why)

  async function retry() {
    busy = true
    error = ''
    const answer = await post('catalog/refresh', {})
    busy = false
    if (answer.error) {
      error = answer.error
      return
    }
    if (answer.unread) {
      latest = answer.unread
      return
    }
    await onread()
  }
</script>

<InlineStatus tone="warning">Oki can't reach mohdex, where the models it offers come from — {shown}.</InlineStatus>
<p class="muted">Until it does, Oki lists no model from it. A local model can still be set up.</p>
<button class="btn" data-style="outline" type="button" disabled={busy} onclick={retry}>{busy ? 'Reading mohdex…' : 'Retry'}</button>
{#if error}
  <InlineStatus tone="danger" role="alert">{error}</InlineStatus>
{/if}

<style>
  .muted {
    color: var(--text-muted);
  }
</style>
