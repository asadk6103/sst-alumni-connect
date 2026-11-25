"""Starter website content created on first start; administrators edit or replace it in the page builder."""

ABOUT_PAGE = {
    "title": "About the alumni network",
    "seo_title": "About the SST alumni network",
    "seo_description": "SST Alumni Connect brings together graduates of SST Public School Rashidabad to reconnect, network, mentor and give back.",
    "featured_image_id": None,
    "blocks": [
        {
            "id": "about-hero",
            "type": "hero",
            "hidden": False,
            "heading": "One school. One family. Everywhere.",
            "subheading": "SST Alumni Connect is the official network of SST Public School Rashidabad graduates — across batches, cities and countries.",
            "image_id": None,
            "button_label": "Join the network",
            "button_url": "/register",
            "secondary_label": "Contact us",
            "secondary_url": "/contact",
            "align": "left",
            "overlay": 60,
        },
        {
            "id": "about-text",
            "type": "rich_text",
            "hidden": False,
            "heading": "Our purpose",
            "text": "The alumni network keeps SSTians connected long after graduation.\n\n"
            "- **Reconnect** with classmates and batchmates.\n- **Network** and share opportunities.\n"
            "- **Mentor** current students and young alumni.\n- **Give back** through scholarships and school projects.",
        },
        {
            "id": "about-stats",
            "type": "stats",
            "hidden": False,
            "heading": "The network today",
            "items": [
                {"label": "Registered alumni", "value": "", "source": "alumni"},
                {"label": "Verified members", "value": "", "source": "verified"},
                {"label": "Countries", "value": "", "source": "countries"},
                {"label": "Batches", "value": "", "source": "batches"},
            ],
        },
        {
            "id": "about-cta",
            "type": "cta",
            "hidden": False,
            "heading": "Are you an SSTian?",
            "text": "Register in a few minutes. The alumni office verifies every member.",
            "button_label": "Register now",
            "button_url": "/register",
            "style": "navy",
        },
    ],
}
