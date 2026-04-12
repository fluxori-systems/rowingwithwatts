import { config, collection, fields } from "@keystatic/core";

export default config({
  storage: {
    kind: "local",
  },
  ui: {
    brand: {
      name: "Rowing With Watts",
    },
  },

  collections: {
    posts: collection({
      label: "Posts",
      slugField: "title",
      path: "src/content/blog/en/*",
      format: { contentField: "content" },
      schema: {
        title: fields.slug({
          name: { label: "Title" },
          slug: {
            label: "Slug",
            description: "URL-friendly identifier (auto-generated from title)",
          },
        }),
        description: fields.text({
          label: "Description / Excerpt",
          multiline: true,
          description: "Shown in blog card and meta description (max 200 chars)",
        }),
        publishedAt: fields.date({
          label: "Published Date",
          defaultValue: { kind: "today" },
        }),
        author: fields.text({
          label: "Author",
          defaultValue: "Tarquin Stapa",
        }),
        image: fields.image({
          label: "Featured Image",
          directory: "public/uploads",
          publicPath: "/uploads",
        }),
        imageAlt: fields.text({ label: "Image Alt Text" }),
        tags: fields.array(fields.text({ label: "Tag" }), {
          label: "Tags",
          itemLabel: (props) => props.value || "Tag",
        }),
        draft: fields.checkbox({
          label: "Draft",
          description: "Draft posts are hidden in production",
          defaultValue: true,
        }),
        featured: fields.checkbox({
          label: "Featured",
          defaultValue: false,
        }),
        seoTitle: fields.text({ label: "SEO Title" }),
        seoDescription: fields.text({
          label: "SEO Description",
          multiline: true,
        }),
        content: fields.mdx({ label: "Content" }),
      },
    }),

    pages: collection({
      label: "Pages",
      slugField: "title",
      path: "src/content/pages/*",
      format: { contentField: "content" },
      schema: {
        title: fields.slug({
          name: { label: "Title" },
          slug: { label: "Slug" },
        }),
        description: fields.text({
          label: "Description",
          multiline: true,
        }),
        content: fields.mdx({ label: "Content" }),
      },
    }),
  },
});
