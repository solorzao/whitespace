# Whitespace project plan

## MVP scope

- Use a small set of data sources and locations for the demonstration.
- Convert the source data to one common format.
- Show pins at the locations that have data.
- Let the user select a pin to see the data and its source.
- Let the user select a location and ask a question about a location (upon click a box will highlight the seected area and a chat window will open).
- Use relevant source data to produce the AI answer.

Possible sources include Wikipedia, Google reviews, YouTube, social media posts, Zillow, and LinkedIn.
The team will select the sources for the MVP. Support for all these sources is outside the MVP scope.

## Team

| Owner | Work | Result |
| --- | --- | --- |
| Kevin | Collect the data. Convert the data to a common format. | Data with locations and source links. |
| Hadi | Design and build the front end, globe, and AI controls. | A user interface for the map and AI questions. |
| Oliver | Build the retrieval system for the AI. | Relevant data for each user question. |

The retrieval system will use retrieval-augmented generation (RAG) or a similar method.

## Infrastructure

| Service | Use |
| --- | --- |
| Azure | Back end infrastructure. |
| Vercel | Front end deployment. |

## Build steps

1. Select the demonstration locations and data sources.
2. Agree on the common data format and API format.
3. Build the data collection, user interface, and retrieval system.
4. Connect the three parts.
5. Deploy the MVP and test the demonstration.

## Completion checks

- [ ] The globe shows pins for the demonstration data.
- [ ] A user can select a pin and read its data.
- [ ] A user can ask a question and receive an answer based on relevant data.
- [ ] The answer includes links to its sources.
- [ ] The front end and back end work together after deployment.

## Open decisions

- Data sources and locations: TBD.
- Common data format and API format: TBD.
- Azure services and AI model: TBD.
- Deployment owner: TBD.

## Note

Use the [shared scratch pad](https://docs.google.com/document/d/1nVFH77cD7XMB1Ul2_t1LTsmJRh87-5y_1E3sKQqbnEo/edit?usp=sharing) for team notes and ideas.
