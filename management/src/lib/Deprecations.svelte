<script>
  import { get, post } from '$lib/api.js'
  import ModelList from '$lib/ModelList.svelte'
  import InfoSection from '$lib/ui/InfoSection.svelte'
  import InlineStatus from '$lib/ui/InlineStatus.svelte'

  let { offers, onmoved } = $props()

  let busy = $state(false)
  let error = $state('')
  let choosing = $state(null)
  let models = $state(null)
  let results = $state({})

  async function move(offer, to) {
    busy = true
    error = ''
    const answer = await post('catalog/move', { from: offer.model, to })
    busy = false
    if (answer.error) {
      error = answer.error
      return
    }
    results[offer.model] = answer
    choosing = null
    await onmoved()
  }

  async function chooseAnother(offer) {
    choosing = offer.model
    error = ''
    if (models) return
    const answer = await get('models')
    if (answer.error) {
      error = answer.error
      return
    }
    models = answer
  }

  const runsOn = (offer) => [
    offer.spores.length ? `${offer.spores.length === 1 ? 'the spore' : 'the spores'} ${offer.spores.join(', ')}` : '',
    offer.isDefault ? 'the default for new spores' : ''
  ].filter(Boolean).join(', and ')
</script>

{#each Object.values(results) as done (done.from)}
  {#if done.moved.length || done.defaultMoved}
    <InlineStatus tone="success">
      Moved to {done.to}: {[...done.moved, ...(done.defaultMoved ? ['the default for new spores'] : [])].join(', ')}.
    </InlineStatus>
  {/if}
  {#each done.refused as one (one.name)}
    <InlineStatus tone="danger">
      {one.name} stays on {done.from}{one.type === 'SPORE_RUNNING' ? ' — it is in a turn, and moves only between turns' : ''}: {one.why}
    </InlineStatus>
  {/each}
{/each}

{#if offers.length}
  <InfoSection title="A model in use is retired">
    {#each offers as offer (offer.model)}
      <div class="offer">
        <InlineStatus tone="warning">
          The catalog marks <span class="mono">{offer.model}</span> as retired{#if offer.replacement}, and names
            <span class="mono">{offer.replacement}</span> to replace it{:else}, and the model it names in its place,
            <span class="mono">{offer.missing}</span>, is not in the catalog{/if}.
        </InlineStatus>
        <p>It is {runsOn(offer)}. Oki changes no model by itself: move {offer.spores.length + (offer.isDefault ? 1 : 0) === 1 ? 'it' : 'them'}, or choose another model.</p>
        <div class="actions">
          {#if offer.replacement}
            <button class="btn" data-color="accent" type="button" disabled={busy} onclick={() => move(offer, offer.replacement)}>Move to {offer.replacement}</button>
          {/if}
          <button class="btn" data-style="outline" type="button" disabled={busy} onclick={() => chooseAnother(offer)}>Choose another model</button>
        </div>
        {#if choosing === offer.model && models}
          {#if models.mohdex}
            <InlineStatus tone="warning">mohdex.dev could not be read ({models.mohdex}), so nothing here says whether a model is checked against spore.</InlineStatus>
          {/if}
          <p class="muted">The models in Oki's catalog a spore can run on now. <a href="/oki/setup/">Models</a> adds others.</p>
          <ModelList offers={models.offers} {busy} action="Move to this model" onchoose={(chosen) => move(offer, chosen.model)} />
        {/if}
      </div>
    {/each}
    {#if error}
      <InlineStatus tone="danger" role="alert">{error}</InlineStatus>
    {/if}
  </InfoSection>
{/if}

<style>
  .offer {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
    margin-bottom: var(--s4);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s3);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .muted {
    color: var(--text-muted);
  }
</style>
