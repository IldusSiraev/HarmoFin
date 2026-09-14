import { defineComponent, h } from 'vue';

// Stands in for Nuxt's `#components` module under Vitest. `NuxtLink` renders a
// plain anchor so tests see the same element the browser gets, rather than an
// unresolved custom tag.
export const NuxtLink = defineComponent({
  name: 'NuxtLink',
  props: {
    to: { type: String, required: true },
  },
  setup(props, { slots, attrs }) {
    return () => h('a', { ...attrs, href: props.to }, slots.default?.());
  },
});
