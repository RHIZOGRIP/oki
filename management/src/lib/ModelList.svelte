<script>
  import FormField from '$lib/ui/FormField.svelte'
  import Row from '$lib/ui/Row.svelte'
  import Tag from '$lib/ui/Tag.svelte'
  import TextInput from '$lib/ui/TextInput.svelte'

  let { offers, onchoose, busy, action: actionLabel, current = null } = $props()

  const SHOWN = 40
  const FILTER_FROM = 6

  let filter = $state('')
  let freeOnly = $state(false)

  const isFree = (offer) => offer.free === true || (offer.price?.input === 0 && offer.price?.output === 0)
  const anyFree = $derived(offers.some(isFree))
  const matching = $derived(
    offers.filter((offer) => (!freeOnly || isFree(offer)) &&
      filter.toLowerCase().split(/\s+/).every((word) => `${offer.model} ${offer.label}`.toLowerCase().includes(word)))
  )

  const money = (value) => `$${value.toFixed(2)}`
  function cost(offer) {
    if (offer.billing === 'plan') return 'your plan — not metered'
    if (offer.billing === 'capacity') return 'your own server — no cost per token'
    if (offer.price?.input === 0 && offer.price?.output === 0) return 'free'
    if (offer.price?.input == null || offer.price?.output == null) return offer.inCatalog ? 'in your catalog' : 'no price known: its calls count as $0 against spending limits'
    return `${money(offer.price.input)} / ${money(offer.price.output)} per million tokens in / out${offer.free ? ', with a free tier' : ''}`
  }
</script>

<div class="models">
  {#if offers.length >= FILTER_FROM}
    <div class="filters">
      <FormField label="Filter">
        {#snippet children({ inputProps })}
          <TextInput {...inputProps} bind:value={filter} placeholder="words in the model's name" />
        {/snippet}
      </FormField>
      {#if anyFree}
        <label class="free-only"><input type="checkbox" bind:checked={freeOnly} /> Free models only</label>
      {/if}
    </div>
  {/if}

  {#if !matching.length}
    <p class="muted">No model matches.</p>
  {/if}
  <ul>
    {#each matching.slice(0, SHOWN) as offer (offer.model)}
      <Row title={offer.label}>
        {#snippet tags()}
          {#if offer.model === current}
            <Tag tone="info" label="default" />
          {/if}
          {#if offer.conformance === 'recommended'}
            <Tag tone="success" label="checked against spore" />
          {:else if offer.conformance === 'partial'}
            <Tag tone="warning" label="partial spore conformance" />
          {:else if offer.conformance === 'unchecked'}
            <Tag tone="warning" label="not checked against spore" />
          {/if}
        {/snippet}
        {#snippet detail()}
          {cost(offer)} · <span class="key">{offer.model}</span>
          {#if offer.conformance === 'partial'}
            · <a href="https://mohdex.dev/{offer.model}" target="_blank" rel="noreferrer">details on mohdex</a>
          {/if}
        {/snippet}
        {#snippet action()}
          {#if offer.model !== current}
            <button class="btn" data-style="outline" data-size="sm" type="button" disabled={busy} onclick={() => onchoose(offer)}>{actionLabel}</button>
          {/if}
        {/snippet}
      </Row>
    {/each}
  </ul>
  {#if matching.length > SHOWN}
    <p class="muted">{SHOWN} of {matching.length} shown — the filter narrows them.</p>
  {/if}
</div>

<style>
  .models {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
  }
  .filters {
    display: flex;
    align-items: flex-end;
    gap: var(--s4);
    flex-wrap: wrap;
  }
  .free-only {
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding-bottom: var(--s2);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .key {
    font-family: var(--font-mono);
  }
  .muted {
    color: var(--text-muted);
  }
</style>
