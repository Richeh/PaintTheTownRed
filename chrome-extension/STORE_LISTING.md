# Chrome Web Store listing copy

## Name

Town Red for Rightmove

## Short description

Paint and share collaborative preference areas on Rightmove property maps.

## Single purpose

Town Red adds a collaborative geographic annotation layer to Rightmove property maps so trusted friends or family can mark preferred and disliked areas while house hunting.

## Detailed description

Town Red helps groups compare locations while browsing Rightmove property maps.

Use Town Red to paint preferred areas in blue, mark areas to avoid in red, and share the same geographic overlay with invited collaborators. The overlay stays aligned with the underlying map while panning and zooming. Shared maps are synchronised through Supabase so collaborators can see updates without exchanging files.

Town Red supports owner, editor and viewer roles. Invites can be used to share access to a map without requiring collaborators to create a separate Town Red account first; anonymous Supabase authentication is used automatically.

Town Red only activates on supported Rightmove map pages.

## Suggested category

Productivity

## Privacy practices notes

Town Red processes user-generated content and authentication identifiers needed to provide shared maps. This includes Supabase user IDs, optional display names, shared-map membership/roles, geographic paint strokes, map annotations/labels, invitation metadata and timestamps.

The extension stores session information, user preferences and cached overlay data in browser storage.

Town Red does not sell user data, use it for advertising, or transfer it for purposes unrelated to the extension's single purpose.

The Supabase publishable key is included in the browser client by design. Database access is restricted with authenticated access and Row Level Security. No service-role or secret key is shipped in the extension.

## Host-permission justification

`https://oikkiayjonjouernvjhw.supabase.co/*`

Required to authenticate users and load/save/realtime-sync Town Red shared maps, geographic paint strokes, collaborator information and map annotations.

## Rightmove site access justification

The extension runs only on supported Rightmove property map pages. Access is required to align the Town Red overlay with the map's geographic projection and to provide the annotation interface while the user browses property locations.

## Privacy policy

Use the deployed Town Red web application's `/privacy.html` URL.

## Suggested screenshots

1. Rightmove map with the Town Red toolbar and red/blue painted areas visible.
2. A shared overlay showing collaborator activity and the map selector.
3. Town Red standalone map showing layers and labelled points, if desired as a product-context image.

Do not include personal invite tokens, email addresses, precise home addresses belonging to private individuals, or other sensitive data in screenshots.
