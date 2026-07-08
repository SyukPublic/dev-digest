export function BlogPost({ blog }) {
  return (
    <article>
      <h1>{blog.title}</h1>
      <p className="byline">By {blog.authorName}</p>
      <div dangerouslySetInnerHTML={{ __html: blog.content }} />
    </article>
  )
}
