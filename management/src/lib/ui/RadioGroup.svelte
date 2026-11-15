<script>
  import { setContext } from 'svelte'

  let { value = $bindable(), name, legend, children } = $props()

  setContext('radio-group', {
    get name () { return name },
    get value () { return value },
    set value (next) { value = next }
  })
</script>

<fieldset>
  <legend>{legend}</legend>
  {@render children()}
</fieldset>

<style>
  fieldset {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    padding: 0;
    margin-bottom: var(--s1);
    font-weight: 500;
  }
</style>
